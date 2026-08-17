import { positionalStanding, expectationFor, describeExpectation } from '../../server/core/board'

console.log('positionalStanding (20-team league)')
console.log('exp  pos  score')
for (const [exp, pos] of [[2,1],[2,2],[2,4],[2,8],[2,12],[6,3],[6,6],[6,11],[15,8],[15,10],[15,15],[15,19],[15,20],[1,1],[1,3]] as [number,number][])
  console.log(String(exp).padStart(3), String(pos).padStart(4), String(positionalStanding(pos, exp, 20)).padStart(6))

console.log('\nexpectationFor(reputation, lastFinish=null, 20)')
for (const rep of [92, 85, 70, 55, 40, 27])
  console.log(`  rep ${String(rep).padStart(2)} -> ${expectationFor(rep, null, 20)}  "${describeExpectation(expectationFor(rep, null, 20), 20)}"`)
