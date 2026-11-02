
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const ORIGIN = "https://centurionfirm.taxrescrm.app";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safe(v: unknown) {
  return String(v ?? "").trim();
}

function escapeHtml(v: unknown) {
  return safe(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return reply({ error: "POST required" }, 405);
  }

  if (req.headers.get("Origin") !== ORIGIN) {
    return reply({ error: "Unapproved origin" }, 403);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!url || !anon || !service) {
      return reply({ error: "Missing Supabase configuration" }, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return reply({ error: "Authentication required" }, 401);
    }

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authorization.substring(7);
    const { data: identity, error: identityError } =
      await caller.auth.getUser(token);

    if (identityError || !identity?.user?.email) {
      return reply({ error: "Invalid login session" }, 401);
    }

    const { data: tenantId, error: tenantError } =
      await caller.rpc("current_tenant_id");

    if (tenantError || !tenantId) {
      return reply({ error: "Invalid Centurion tenant context" }, 403);
    }

    const { data: operator, error: operatorError } = await admin
      .from("employees")
      .select("id, access, role, status, perm_hr")
      .eq("tenant_id", tenantId)
      .ilike("email", identity.user.email)
      .maybeSingle();

    if (operatorError || !operator) {
      return reply({ error: "Employee authorization failed" }, 403);
    }

    const role = safe(operator.access || operator.role).toLowerCase();
    const authorized =
      safe(operator.status).toLowerCase() === "active" &&
      (role === "super admin" || Number(operator.perm_hr || 0) >= 2);

    if (!authorized) {
      return reply({ error: "Insufficient permissions" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = safe(body.email).toLowerCase();
    const requestedVia = safe(body.via || "email").toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Valid email required" }, 400);
    }

    if (!["email", "text", "both"].includes(requestedVia)) {
      return reply({ error: "Invalid delivery method" }, 400);
    }

    if (requestedVia !== "email") {
      return reply({
        error: "Centurion invitation setup currently supports email only"
      }, 400);
    }

    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .select("id, name, email, tenant_id, status")
      .eq("tenant_id", tenantId)
      .ilike("email", email)
      .maybeSingle();

    if (employeeError || !employee) {
      return reply({ error: "Employee not found in Centurion" }, 404);
    }

    if (safe(employee.status).toLowerCase() !== "active") {
      return reply({ error: "Employee is not active" }, 403);
    }

    // Multiple legitimate office memberships are allowed. Always authorize
    // this invitation against the selected tenant and its own employee record.
    const { data: firm, error: firmError } = await admin.from("tenants")
      .select("firm_name,status").eq("id", tenantId).single();
    if (firmError || !firm || !["active","trial"].includes(firm.status))
      return reply({error:"Selected office is unavailable"},403);
    const FIRM = safe(firm.firm_name);

    const { data: existing, error: lookupError } = await admin.rpc(
      "taxres_auth_user_by_email",
      { target_email: email }
    );

    if (lookupError) {
      return reply({ error: "Auth lookup failed" }, 500);
    }

    const authUser = Array.isArray(existing) ? existing[0] : null;
    const kind = authUser ? "recovery" : "invite";

    const { data: generated, error: generateError } =
      await admin.auth.admin.generateLink(
        kind === "invite"
          ? {
              type: "invite",
              email,
              options: { data: { name: employee.name } }
            }
          : { type: "recovery", email }
      );

    if (generateError) {
      return reply({ error: generateError.message }, 400);
    }

    const hash = generated?.properties?.hashed_token;

    if (!hash) {
      return reply({ error: "Secure invitation token unavailable" }, 500);
    }

    // Employee invitation must establish authorization in the same office.
    // Auth admin.generateLink returns the actual Supabase user identity.
    const invitedUserId = generated?.user?.id || authUser?.id;
    if (!invitedUserId) return reply({error:"Auth identity unavailable"},500);
    const {error: membershipError} = await admin
      .from("centurion_office_memberships")
      .upsert({user_id: invitedUserId, tenant_id: tenantId, role:"staff", active:true},
              {onConflict:"user_id,tenant_id"});
    if (membershipError) return reply({error:"Office access could not be assigned"},500);
    const {data: selected, error: selectedError} = await admin
      .from("centurion_active_offices").select("tenant_id")
      .eq("user_id",invitedUserId).maybeSingle();
    if (selectedError) return reply({error:"Office selection verification failed"},500);
    if (!selected) {
      const {error: selectError} = await admin.from("centurion_active_offices")
        .insert({user_id:invitedUserId,tenant_id:tenantId});
      if (selectError) return reply({error:"Office selection could not be initialized"},500);
    }

    const link =
      `${ORIGIN}/family-password?token_hash=` +
      encodeURIComponent(hash) +
      `&type=${kind}&tenant_id=${encodeURIComponent(tenantId)}`;

    const heading =
      kind === "invite" ? "Set Up Your Password" : "Reset Your Password";

    const html = `
      <!doctype html>
      <html>
      <body style="margin:0;background:#071522;padding:36px 16px;
        font-family:Arial,Helvetica,sans-serif">
        <table role="presentation" align="center" width="100%"
          style="max-width:560px;background:#10263c;
          border:1px solid #29435a;border-radius:14px">
          <tr>
            <td style="padding:30px;text-align:center;color:#e9a62b;
              font-size:25px;letter-spacing:4px;font-weight:bold">
              CENTURION
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 34px;color:#f2f5fa">
              <h2>${heading}</h2>
              <p style="line-height:1.7">
                Hello ${escapeHtml(employee.name)},
              </p>
              <p style="line-height:1.7;color:#c4d1dd">
                Your secure ${FIRM} CRM access link is ready.
                Use the button below to choose your password.
              </p>
              <p style="text-align:center;margin:32px 0">
                <a href="${escapeHtml(link)}"
                  style="background:#d99a22;color:#08192b;
                  padding:15px 25px;text-decoration:none;
                  border-radius:8px;font-weight:bold">
                  ${heading}
                </a>
              </p>
              <p style="font-size:12px;color:#9fb2c3">
                If you did not request access, contact your administrator.
                Do not forward this security email.
              </p>
            </td>
          </tr>
        </table>
      </body>
      </html>`;

    const mailResponse = await fetch(
      `${url}/functions/v1/send-email`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          apikey: anon,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: email,
          subject: `${FIRM} — ${heading}`,
          from_name: FIRM,
          kind: "employee_access",
          html
        })
      }
    );

    const mailResult = await mailResponse.json().catch(() => ({}));

    if (!mailResponse.ok || mailResult?.success !== true) {
      return reply({
        ok: true,
        mode: kind,
        delivery: "manual",
        access_link: link,
        warning: "Email delivery unavailable; secure link generated"
      });
    }

    return reply({
      ok: true,
      mode: kind,
      delivery: "email",
      email,
      employee_id: employee.id
    });

  } catch (error) {
    console.error("Centurion invitation failure", error);
    return reply({ error: "Invitation failed; check function logs" }, 500);
  }
});
