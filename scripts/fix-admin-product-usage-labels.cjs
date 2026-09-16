const fs = require('fs');

const path = 'src/pages/AdminPortal.jsx';
const s = fs.readFileSync(path, 'utf8');

// Guard the approved Analytics/GA4 terminology without mutating tracked source.
// Production builds must never rewrite current UI back to legacy "Product Usage" copy.
const required = [
  "{ key:'marketing', label:'Analytics' }",
  "{/* ═══ ANALYTICS TAB — GOOGLE ANALYTICS 4 ═══ */}",
  "const title = channel === 'marketing' ? 'Google Analytics 4 reporting' : 'SEO reporting'",
  "GA4 Data API connection",
  "Analytics · Google Analytics 4 (GA4)",
  "Live GA4 traffic and behavior metrics for each RomyLabs product.",
  "{ label:'Sessions Today',",
  "{ label:'Users Today',",
  "<div style={CC.sectionLabel}>Top pages — last 7 days</div>",
  "{p.views} sessions",
];

for (const needle of required) {
  if (!s.includes(needle)) {
    throw new Error(`Admin Analytics contract missing: ${needle}`);
  }
}

const forbidden = [
  "{ key:'marketing', label:'Product Usage' }",
  "Product Usage · GA4 tracked activity",
  "Tracked Sessions Today",
  "Active Users Today",
  "Most-used routes — last 7 days",
  "GA4 product-usage connection",
];

for (const needle of forbidden) {
  if (s.includes(needle)) {
    throw new Error(`Legacy Product Usage copy regressed into Admin Portal: ${needle}`);
  }
}

console.log('Admin Analytics / GA4 labels verified without mutating source');
