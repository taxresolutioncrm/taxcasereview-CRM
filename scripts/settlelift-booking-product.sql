-- Add SettleLift to the existing shared scheduling engine without changing other products.
do $patch$
declare s text;
begin
 select pg_get_functiondef('public.booking_create_product(text,text,text,text,date,text,text,text,text)'::regprocedure) into s;
 if position('''settlelift''' in s)=0 then
   s:=replace(s,'''barbers_salons'') then','''barbers_salons'',''settlelift'') then');
   s:=replace(s,'''barbers_salons'',''health_insurance'') then','''barbers_salons'',''health_insurance'',''settlelift'') then');
   if position('''settlelift''' in s)=0 then raise exception 'Unrecognized booking allowlist; no changes applied'; end if;
 end if;
 if position('when v_product = ''settlelift''' in s)=0 and position('when ''settlelift'' then' in s)=0 then
   if position('v_label := case v_product' in s)>0 then
     s:=replace(s,'v_label := case v_product','v_label := case v_product'||chr(10)||'    when ''settlelift'' then ''[SettleLift]''');
   else
     s:=replace(s,'v_label := case','v_label := case'||chr(10)||'    when v_product = ''settlelift'' then ''[SettleLift]''');
   end if;
 end if;
 execute s;
end $patch$;