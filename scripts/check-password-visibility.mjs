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


const family='src/pages/FamilyPassword.jsx'
const portal='src/pages/EmployeePortal.jsx'
const clock='src/pages/ClockIn.jsx'
for(const n of [
  "const [showPassword,setShowPassword]=useState(false)",
  "const [showConfirm,setShowConfirm]=useState(false)",
  "type={showPassword?'text':'password'}",
  "type={showConfirm?'text':'password'}",
  "Show new password",
  "Show confirmation password"
]) {
  const text=fs.readFileSync(family,'utf8')
  if(!text.includes(n)) failures.push('TaxRes family password setup missing '+n)
}
for(const n of [
  "const [showLoginPin, setShowLoginPin] = useState(false)",
  "type={showLoginPin ? 'text' : 'password'}",
  "aria-label={showLoginPin ? 'Hide PIN' : 'Show PIN'}",
  "const [showNewPin, setShowNewPin] = useState(false)",
  "const [showConfirmPin, setShowConfirmPin] = useState(false)",
  "type={showNewPin?'text':'password'}",
  "type={showConfirmPin?'text':'password'}"
]) {
  const text=fs.readFileSync(portal,'utf8')
  if(!text.includes(n)) failures.push('Employee portal PIN visibility missing '+n)
}
for(const n of [
  "[showPin,setShowPin]=useState(false)",
  "type={showPin?'text':'password'}",
  "aria-label={showPin?'Hide PIN':'Show PIN'}"
]) {
  const text=fs.readFileSync(clock,'utf8')
  if(!text.includes(n)) failures.push('Time clock PIN visibility missing '+n)
}

if(failures.length){
  console.error('TaxRes password visibility contract failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes password visibility contract passed')
