import fc from 'fast-check'
import { TransferCommand } from './TransferCommand'
import { GetBalanceCommand } from './GetBalanceCommand'
import { bnUint256 } from '../arbitraries/BNUint256Arbitrary'

export const TokenCommands = fc.commands(
  [bnUint256().map((amt) => new TransferCommand(amt)), fc.constant(new GetBalanceCommand())],
  { maxCommands: 100 }
)
