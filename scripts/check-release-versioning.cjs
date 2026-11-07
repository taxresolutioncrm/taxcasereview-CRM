const fs=require('fs');const assert=require('assert');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const release=fs.readFileSync('src/releaseInfo.js','utf8');
const sidebar=fs.readFileSync('src/components/layout/Sidebar.jsx','utf8');
assert(/^\d+\.\d+\.\d+$/.test(pkg.version),'package version must be semantic x.y.z');
assert(release.includes(`version: '${pkg.version}'`),'release manifest and package version must match');
assert(sidebar.includes('v{releaseInfo.version}'),'visible sidebar production version missing');
assert(sidebar.includes("What's New"),'release notes panel missing');
assert(sidebar.includes('getReleaseInfo'),'sidebar must resolve per-office release metadata');
assert(release.includes('OFFICE_RELEASES'),'per-office version support missing');
assert(pkg.version === '3.0.0' || /^3\.\d+\.\d+$/.test(pkg.version),'current formal-versioning line must remain in major version 3');
assert(release.includes('Formal semantic versioning begins with this release baseline'),'formal v3.0.0 baseline disclosure missing');
const nashvilleBlock = release.match(/'489ace07-1a6b-4864-833a-4f8420568b40':[\s\S]*?\n  },/)?.[0] || '';
assert(nashvilleBlock,'Nashville independent release line missing');
assert(nashvilleBlock.includes("version: '3.0.0'"),'Nashville baseline must start independently at v3.0.0');
assert(!nashvilleBlock.includes('Employee note editing'),'Nashville release notes must not claim note editing before Nashville ships it');
assert(!nashvilleBlock.includes('Note editor performance optimization'),'Nashville release notes must not claim TCR note performance work');

// Shared source can ship to several independently-versioned offices. Each
// affected customer line must advance relative to its own production baseline.
function officeVersion(contents, office) {
  const marker = '// ' + office
  const index = contents.indexOf(marker)
  assert(index >= 0, office + ': release entry missing')
  const match = contents.slice(index).match(/version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/)
  assert(match, office + ': invalid office version')
  return match[1]
}
function semverGreater(next, prev) {
  const n = next.split('.').map(Number), p = prev.split('.').map(Number)
  return n[0]>p[0] || (n[0]===p[0] && (n[1]>p[1] || (n[1]===p[1] && n[2]>p[2])))
}

const {execFileSync}=require('child_process')
const semver = v => /^[0-9]+[.][0-9]+[.][0-9]+$/.test(v||'')
const versionFrom = (contents, label) => {
  const found = contents.match(/version: '([0-9]+[.][0-9]+[.][0-9]+)'/)
  assert(found && semver(found[1]), label + ': missing semantic release version')
  return found[1]
}
function git(args) {
  try { return execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim() }
  catch (e) { throw new Error('Release accountability cannot inspect Git history: '+(e.stderr?.toString()||e.message)) }
}
// Compare against the last release-manifest commit, not merely HEAD's parent:
// a PR can contain several functional commits before its single final version bump.
// A new shared functionality commit after that bump MUST update releaseInfo.js.
// PR builds checkout GitHub's synthetic merge commit. Its first parent is main,
// which may contain unrelated changes after this PR updated its manifest.
// Validate the PR's second-parent tip instead of treating base changes as PR changes.
const effectiveHead = process.env.GITHUB_EVENT_NAME === 'pull_request'
  ? git(['rev-parse','HEAD^2'])
  : 'HEAD'
const manifestCommits = git(['log','--format=%H','-2',effectiveHead,'--','src/releaseInfo.js']).split(/\r?\n/).filter(Boolean)
assert(manifestCommits.length,'Cannot identify the current release manifest commit')
const mostRecentManifest = manifestCommits[0]
const afterRelease = git(['diff','--name-only',mostRecentManifest,effectiveHead,'--','src','public','supabase/functions'])
  .split(/\r?\n/).filter(Boolean).filter(file=>file !== 'src/releaseInfo.js')
assert(afterRelease.length===0,
  'Functional files changed after the last release-manifest update without new version and release notes: '+afterRelease.join(', '))
// A cosmetic edit to release notes cannot substitute for an actual version bump
// when functional files changed since the preceding manifest revision.
// A later merge that only repairs build scripts must not be charged with
// functional changes introduced by a prior production release. Still enforce
// the bump if this exact production merge changes any functional source.
const productionReleaseCandidateDiff = process.env.GITHUB_EVENT_NAME === 'pull_request'
  ? git(['diff','--name-only','HEAD^1','HEAD^2','--','src','public','supabase/functions'])
  : process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_NAME === 'main'
    ? git(['diff','--name-only','HEAD^1','HEAD','--','src','public','supabase/functions'])
    : null
// Do not re-test version bumps from old release history when this PR/push
// changes only verification scripts (and no CRM functional code).
const isNonfunctionalReleaseCandidate = productionReleaseCandidateDiff!==null && !productionReleaseCandidateDiff.trim()
if (manifestCommits.length > 1 && !isNonfunctionalReleaseCandidate) {
  const olderManifest = manifestCommits[1]
  const changedSincePreviousRelease = git(['diff','--name-only',olderManifest,mostRecentManifest,'--','src','public','supabase/functions'])
    .split(/\r?\n/).filter(Boolean).filter(file=>file !== 'src/releaseInfo.js')
  if (changedSincePreviousRelease.length) {
    const oldContent = git(['show',olderManifest+':src/releaseInfo.js'])
    // During PR checks, compare against the target branch release, not each
    // intermediate manifest amendment in the same unmerged PR.
    const isSandboxPush = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_NAME === 'sandbox/demo-lead-workspace-20261030'
    // For a production merge commit, HEAD^1 is the previous production main.
    // Intermediate changes to releaseInfo.js inside the same PR are NOT previous
    // releases; comparing against them caused valid 3.2.43 merges to fail on push.
    const isMainPush = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_NAME === 'main'
    const baselineRelease = process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? git(['show','HEAD^1:src/releaseInfo.js'])
      : isMainPush
        ? git(['show','HEAD^1:src/releaseInfo.js'])
        : isSandboxPush
          ? git(['show','origin/main:src/releaseInfo.js'])
          : oldContent
    const oldVersion = versionFrom(baselineRelease,'previous release')
    const currentVersion = versionFrom(release,'current release')
    assert(oldVersion !== currentVersion,
      'Functional changes must bump the shared source version and provide release notes')
    const [om,oni,op] = oldVersion.split('.').map(Number)
    const [nm,nni,np] = currentVersion.split('.').map(Number)
    assert(nm>om || (nm===om && (nni>oni || (nni===oni && np>op))),
      'Version must increase, not simply change')
    // Admin Portal booking/task UI is independently scoped: do not force a
    // release bump for unrelated customer offices when their code did not change.
    const adminOnlyFiles = new Set(['src/components/AdminCalendarPreview.css','src/components/AdminCalendarPreview.jsx','src/components/InternalBooking.jsx','src/lib/bookingEmails.js','src/pages/Calendar.jsx','public/admin-portal-build.txt','src/components/AdminBookingAlerts.jsx','src/components/AdminOculivoDemoRequests.jsx','supabase/functions/oculivo-demo-intake/index.ts','src/pages/AdminPortal.jsx','supabase/functions/daily-briefing/index.ts','src/lib/adminProductOrdering.js','src/pages/BookAppointment.jsx','src/lib/productBookingConfig.js','src/components/admin/RomyLabsBilling.jsx','supabase/functions/hub-proxy/index.ts'])
    const scopedFiles = process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? git(['diff','--name-only','HEAD^1','HEAD^2','--','src','public','supabase/functions']).split(/\r?\n/).filter(Boolean)
      : process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_NAME?.startsWith('sandbox/')
        ? git(['diff','--name-only','origin/main','HEAD','--','src','public','supabase/functions']).split(/\r?\n/).filter(Boolean)
        : changedSincePreviousRelease
    const scopedFunctionalFiles = scopedFiles.filter(file => file !== 'src/releaseInfo.js')
    const adminOnlyRelease = scopedFunctionalFiles.length>0 && scopedFunctionalFiles.every(file => adminOnlyFiles.has(file))
    if (!adminOnlyRelease) {
      for (const office of ['Tax Case Review','Centurion Firm']) {
        const before = officeVersion(baselineRelease, office)
        const after = officeVersion(release, office)
        assert(semverGreater(after, before),
          office + ' must advance its own version for shared CRM changes (' + before + ' -> ' + after + ')')
      }
    }
    if (adminOnlyRelease) {
      assert(/changes:\s*(?:ADMIN_DEMO_TASK_CHANGES|\[[^\]]*\.\.\.ADMIN_DEMO_TASK_CHANGES[^\]]*\])/.test(release),
        'Admin Portal-only functional changes require Admin Portal release notes')
    } else {
      assert(release.includes("changes: IRS_WORKFLOW_CHANGES"),
        'Shared CRM functional changes require office release notes')
    }
  }
}
console.log('PASS semantic release gate: functional source requires a version bump and notes')

console.log('PASS CRM release version accountability');
