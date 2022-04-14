import { Implementation, IMPLEMENTATION } from '../fixtures'

export const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

export const describeGas = ( IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS) ? describe : describe.skip
