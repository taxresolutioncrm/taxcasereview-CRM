// Dynamic dashboard text must be translated by the live UI bridge, not only
// by the static dictionary: greetings include a user's name and an emoji.
const GREETINGS = [
  ['Good morning', 'Buenos días'],
  ['Good afternoon', 'Buenas tardes'],
  ['Good evening', 'Buenas noches'],
]

export function translateDashboardGreeting(value, lang = 'en') {
  if (typeof value !== 'string') return value
  const pairs = lang === 'es' ? GREETINGS : GREETINGS.map(([en, es]) => [es, en])
  for (const [from, to] of pairs) {
    if (value === from) return to
    if (value.startsWith(from + ', ')) return to + value.slice(from.length)
  }
  return value
}
