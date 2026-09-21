import fs from 'node:fs'

const failures=[]
const s=fs.readFileSync('src/pages/Login.jsx','utf8')
for(const needle of [
  "const [showPassword, setShowPassword] = useState(false)",
  "type={showPassword ? 'text' : 'password'}",
  "onClick={() => setShowPassword(v => !v)}",
  "aria-label={showPassword ? 'Hide password' : 'Show password'}",
  "tcr-password-eye",
]) if(!s.includes(needle)) failures.push('TaxRes login missing '+needle)

if(failures.length){
  console.error('TaxRes password visibility contract failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes password visibility contract passed')
