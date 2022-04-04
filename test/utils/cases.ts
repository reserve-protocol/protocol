// Utility functions for composing test cases

// If anyone wants to get this typing correctly without using any, that'd be cool.
// But this is really the sort of thing that would've already broken badly if it was gonna, so,
/* eslint-disable @typescript-eslint/no-explicit-any */

// Yoinked from: https://stackoverflow.com/questions/65025411/
type MapCartesian<T extends any[][]> = {
  [P in keyof T]: T[P] extends Array<infer U> ? U : never
}
/* Returns (as an array) the cartesian product of any number of input arrays
   Some examples:
   cartesianProduct([0, 1, 2], ['a', 'b']) ==
       [ [ 0, 'a' ], [ 0, 'b' ], [ 1, 'a' ], [ 1, 'b' ], [ 2, 'a' ], [ 2, 'b' ] ]
   cartesianProduct(['x'], ['y'], [0,1,2]) ==
       [ ['x', 'y', 0], ['x', 'y', 1], ['x', 'y', 2] ]

   cartesianProduct() == [ [] ]
   cartesianProduct([]) == [ ]
*/
export const cartesianProduct = <T extends any[][]>(...arr: T): MapCartesian<T>[] =>
  arr.reduce((a, b) => a.flatMap((c) => b.map((d) => [...c, d])), [[]]) as MapCartesian<T>[]
