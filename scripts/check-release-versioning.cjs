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

const {execFileSync}=require('child_process')
const semver = v => /^\\d+\\.\\d+\\.\\d+$/.test(v||'')
const versionFrom = (contents, label) => {
  const found = contents.match(new RegExp("version: '([0-9]+\\\\.[0-9]+\\\\.[0-9]+)'"))
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
const manifestCommits = git(['log','--format=%H','-2','--','src/releaseInfo.js']).split('\\n').filter(Boolean)
assert(manifestCommits.length,'Cannot identify the current release manifest commit')
const mostRecentManifest = manifestCommits[0]
const afterRelease = git(['diff','--name-only',mostRecentManifest,'HEAD','--','src','public','supabase/functions'])
  .split('\\n').filter(Boolean).filter(file=>file !== 'src/releaseInfo.js')
assert(afterRelease.length===0,
  'Functional files changed after the last release-manifest update without new version and release notes: '+afterRelease.join(', '))
// A cosmetic edit to release notes cannot substitute for an actual version bump
// when functional files changed since the preceding manifest revision.
if (manifestCommits.length > 1) {
  const olderManifest = manifestCommits[1]
  const changedSincePreviousRelease = git(['diff','--name-only',olderManifest,mostRecentManifest,'--','src','public','supabase/functions'])
    .split('\\n').filter(Boolean).filter(file=>file !== 'src/releaseInfo.js')
  if (changedSincePreviousRelease.length) {
    const oldContent = git(['show',olderManifest+':src/releaseInfo.js'])
    const oldVersion = versionFrom(oldContent,'previous release')
    const currentVersion = versionFrom(release,'current release')
    assert(oldVersion !== currentVersion,
      'Functional changes must bump the shared source version and provide release notes')
    const [om,oni,op] = oldVersion.split('.').map(Number)
    const [nm,nni,np] = currentVersion.split('.').map(Number)
    assert(nm>om || (nm===om && (nni>oni || (nni===oni && np>op))),
      'Version must increase, not simply change')
    for (const office of ['Tax Case Review','CloudCPA','Centurion Firm']) {
      const section = release.slice(release.indexOf('// '+office))
      assert(section && section.includes("version: '"+currentVersion+"'"),
        office+' must explicitly carry this release version')
    }
    assert(release.includes("changes: IRS_WORKFLOW_CHANGES"),
      'Functional changes require recorded release notes for offices')
  }
}
console.log('PASS semantic release gate: functional source requires a version bump and notes')

console.log('PASS CRM release version accountability');
