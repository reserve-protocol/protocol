import { readFileSync, WriteStream, createWriteStream } from 'fs'
import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { fp } from '../../../../common/numbers'
import { ETH_TOKEN, BANCOR_POOL_COLLECTION } from './constants'

const FIRST_BLOCK = 16828000 // pool collection created at 16827977
const LAST_BLOCK = 16960000 // latest block at the time of writing: 16964294

const TOKEN_ABI = readFileSync(
  'test/plugins/individual-collateral/bancor-v3/PoolCollection.abi.txt',
  'utf-8'
)

const poolCollectionContract = new ethers.Contract(
  BANCOR_POOL_COLLECTION,
  TOKEN_ABI,
  ethers.provider
)

const _range = (start: number, count: number, step: number): Array<number> => {
  return Array(count)
    .fill(step)
    .map((x, y) => start + x * y)
}

const range = (start: number, stop: number, step: number): Array<number> => {
  return _range(start, 1 + Math.floor((stop - start) / step), step)
}

const getRefPerTok = async (pool: Contract, block: number) => {
  const _rate = await pool.poolTokenToUnderlying(ETH_TOKEN, fp('1'), { blockTag: block })
  return (_rate as BigNumber).toString()
}

const plot = async (pool: Contract, blocks: Array<number>, stream: WriteStream) => {
  const _rates: Array<string> = []
  for (const _b of blocks) {
    const _r = await getRefPerTok(pool, _b)
    stream.write(_b.toString() + ';' + _r + '\n')
    console.log(_b.toString() + '; ' + _r)
    _rates.push(_r)
  }
  return _rates
}

// 3-4h pass between every 1000 blocks
const BLOCKS = range(FIRST_BLOCK, LAST_BLOCK, 1000)

// create the streams
const usdcRefPerTokStream = createWriteStream('ref-per-tok.usdc.csv', { flags: 'a' })

// write the data
plot(poolCollectionContract, BLOCKS, usdcRefPerTokStream).finally(() => usdcRefPerTokStream.end())
