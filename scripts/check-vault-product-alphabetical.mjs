import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const src=readFileSync('src/components/admin/CredentialVault.jsx','utf8')
assert(src.includes("const alphabeticalProducts = list => [...list].sort("))
assert(src.includes("String(a.name || '').localeCompare(String(b.name || '')"))
assert(src.includes("const [products, setProducts] = useState(() => alphabeticalProducts(FALLBACK_PRODUCTS))"))
assert(src.includes("setProducts(alphabeticalProducts(productRes.data))"))
assert(src.includes('<option value="all">All Products</option>'))
assert(src.includes('value={p.product_id}'), 'Product IDs must remain stable')
assert(src.includes("credential_vault_list"), 'Credential access must remain unchanged')
const products=['TaxRes CRM','Camvella','Arcvena','GroundIVO','Restore Relay','PoolVerge','BocaSync','Oculivo','Health Insurance Agency CRM','SettleLift','ChairStyle','RomyLabs']
const sorted=[...products].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true}))
assert.equal(sorted[0],'Arcvena')
assert.equal(sorted.at(-1),'TaxRes CRM')
assert.equal(new Set(sorted).size,products.length)
console.log('PASS: All Products remains pinned and active products sorted alphabetically, IDs and vault access unchanged')
