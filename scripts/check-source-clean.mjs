import { spawnSync } from 'node:child_process'

const paths=['src','scripts','package.json','vite.config.js']

function gitDiff(args,label){
  const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true})
  if(r.error){
    console.error(`ERROR: could not run git for ${label}: ${r.error.message}`)
    process.exit(1)
  }
  if(r.status===0) return
  if(r.status===1){
    console.error(`ERROR: tracked source changed during build (${label}). Commit the source fix instead of mutating source in prebuild.`)
    if(r.stdout) process.stderr.write(r.stdout)
    if(r.stderr) process.stderr.write(r.stderr)
    process.exit(1)
  }
  console.error(`ERROR: git ${label} check failed with status ${r.status}`)
  if(r.stdout) process.stderr.write(r.stdout)
  if(r.stderr) process.stderr.write(r.stderr)
  process.exit(r.status||1)
}

gitDiff(['diff','--quiet','--',...paths],'working tree')
gitDiff(['diff','--cached','--quiet','--',...paths],'index')
console.log('PASS  tracked source is clean')
