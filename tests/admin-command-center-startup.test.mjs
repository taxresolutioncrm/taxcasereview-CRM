import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync('src/pages/AdminPortal.jsx', 'utf8')
const ccStart = source.indexOf('function CommandCenter() {')
const ccEnd = source.indexOf('function ', ccStart+22)
assert(ccStart >= 0, 'CommandCenter component must exist')
const cc = source.slice(ccStart, ccEnd<0 ? undefined : ccEnd)
const declaration = "const [seoProduct, setSeoProduct] = useState('taxres_crm')"
const declarationIndex = cc.indexOf(declaration)
const seoEffectStart = cc.indexOf("if (tab === 'search') fetchGSC(seoProduct)")
const dependencyIndex = cc.indexOf('}, [tab, seoProduct])')
assert(declarationIndex >= 0, 'SEO selection state declaration missing')
assert(cc.split(declaration).length === 2, 'SEO selection must be declared exactly once')
assert(seoEffectStart >= 0 && dependencyIndex >= 0, 'Selected-property GSC effect must remain mounted')
assert(declarationIndex < seoEffectStart && declarationIndex < dependencyIndex,
  'Command Center render crashes: seoProduct is used by a hook before its declaration')
assert(cc.includes('if (tab === \'search\') fetchBing(seoProduct)'),
  'Existing Bing product selection must remain scoped')
assert(cc.includes("if (gscCode) {") && cc.includes("setSeoProduct(product)"),
  'Existing Google OAuth selected-product routing must remain intact')
assert(cc.includes("clarityConfiguredProducts={clarityRows.filter"),
  'Existing PoolVerge Clarity status must remain intact')

// Verify the exact JavaScript failure mode to guard against a future reorder.
// This is a render-time dependency evaluation, not a Vite compilation check.
const render = lines => new Function('useState', 'useEffect', lines.join('\n'))(
  initial => [initial, () => {}],
  (_fn, deps) => { assert.equal(deps[0], 'taxres_crm') }
)
const stateLine = declaration
const effectLine = "useEffect(() => {}, [seoProduct])"
render([stateLine,effectLine])
assert.throws(() => render([effectLine,stateLine]), ReferenceError,
  'A hook referencing state before declaration must reproduce the original crash')
console.log('PASS Command Center startup: seoProduct initialized before hook dependency evaluation')
console.log('PASS existing Google property selection, Bing and Clarity integration preserved')
console.log('PASS regression test reproduces and rejects the original production ReferenceError')
