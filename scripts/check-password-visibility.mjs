import fs from 'node:fs'

const failures=[]
const text=fs.readFileSync('src/pages/Login.jsx','utf8')
const family=fs.readFileSync('src/pages/FamilyPassword.jsx','utf8')
for(const needle of [
  "const [showPassword, setShowPassword] = useState(false)",
  "type={showPassword ? 'text' : 'password'}",
  "onClick={() => setShowPassword(v => !v)}",
  "aria-label={showPassword ? 'Hide password' : 'Show password'}",
  "tcr-password-eye2"
]) if(!text.includes(needle)) failures.push('Login password visibility missing '+needle)

for(const needle of [
  "const [showPassword,setShowPassword]=useState(false)",
  "const [showConfirm,setShowConfirm]=useState(false)",
  "type={showPassword?'text':'password'}",
  "type={showConfirm?'text':'password'}",
  "aria-label={showPassword?'Hide new password':'Show new password'}",
  "aria-label={showConfirm?'Hide confirmation password':'Show confirmation password'}"
]) if(!family.includes(needle)) failures.push('Family password visibility missing '+needle)

if(failures.length){
  console.error('TaxRes family password visibility check failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes family password visibility contract passed')
