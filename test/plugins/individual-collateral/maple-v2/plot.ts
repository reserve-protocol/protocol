import { readFileSync, WriteStream, createWriteStream } from 'fs'
import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { fp } from '../../../../common/numbers'
import { MAPLE_USDC_POOL, MAPLE_WETH_POOL } from './constants'

const FIRST_BLOCK = 16162600 // pools created at 16162554
const LAST_BLOCK = 16962600 // latest block at the time of writing: 16964294

const POOL_ABI = readFileSync('test/plugins/individual-collateral/maple-v2/Pool.abi.txt', 'utf-8')

const usdcPoolContract = new ethers.Contract(MAPLE_USDC_POOL, POOL_ABI, ethers.provider)
const wethPoolContract = new ethers.Contract(MAPLE_WETH_POOL, POOL_ABI, ethers.provider)

const _range = (start: number, count: number, step: number): Array<number> => {
  return Array(count)
    .fill(step)
    .map((x, y) => start + x * y)
}

const range = (start: number, stop: number, step: number): Array<number> => {
  return _range(start, 1 + Math.floor((stop - start) / step), step)
}

const getRefPerTok = async (pool: Contract, block: number, exit = true) => {
  let _rate = await pool.convertToAssets(fp('1'), { blockTag: block })
  if (exit) _rate = await pool.convertToExitAssets(fp('1'), { blockTag: block })
  return (_rate as BigNumber).toString()
}

const plot = async (pool: Contract, blocks: Array<number>, exit: boolean, stream: WriteStream) => {
  const _rates: Array<string> = []
  for (const _b of blocks) {
    const _r = await getRefPerTok(pool, _b, exit)
    stream.write(_b.toString() + ';' + _r + '\n')
    console.log(_b.toString() + '; ' + _r)
    _rates.push(_r)
  }
  return _rates
}

// 3-4h pass between every 1000 blocks
const BLOCKS = range(FIRST_BLOCK, LAST_BLOCK, 1000)

// create the streams
const usdcRefPerTokDepositStream = createWriteStream('ref-per-tok.usdc.deposit.csv', { flags: 'a' })
const usdcRefPerTokRedeemStream = createWriteStream('ref-per-tok.usdc.redeem.csv', { flags: 'a' })
const wethRefPerTokDepositStream = createWriteStream('ref-per-tok.weth.deposit.csv', { flags: 'a' })
const wethRefPerTokRedeemStream = createWriteStream('ref-per-tok.weth.redeem.csv', { flags: 'a' })

// write the data
plot(usdcPoolContract, BLOCKS, false, usdcRefPerTokDepositStream).finally(() =>
  usdcRefPerTokDepositStream.end()
)
plot(usdcPoolContract, BLOCKS, true, usdcRefPerTokRedeemStream).finally(() =>
  usdcRefPerTokRedeemStream.end()
)
plot(wethPoolContract, BLOCKS, false, wethRefPerTokDepositStream).finally(() =>
  wethRefPerTokDepositStream.end()
)
plot(wethPoolContract, BLOCKS, true, wethRefPerTokRedeemStream).finally(() =>
  wethRefPerTokRedeemStream.end()
)
