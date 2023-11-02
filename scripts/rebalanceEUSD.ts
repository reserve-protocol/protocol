import { ZERO_ADDRESS } from '#/common/constants'
import { TransactionResponse } from '@ethersproject/providers'
import { EUSDRebalance } from '@typechain/EUSDRebalance'
import { BigNumberish, Transaction } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'
import hre from 'hardhat'

const CUSDC = '0x39AA39c021dfbaE8faC545936693aC917d5E7563'
const CUSDT = '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9'

const USDCToken = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
}

const USDTToken = {
  address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  symbol: 'USDT',
  decimals: 6,
}

const sellTokens = [
  {
    address: CUSDC,
    symbol: 'CUSDC',
    decimals: 8,
    underlying: USDCToken,
  },
  {
    address: CUSDT,
    symbol: 'CUSDT',
    decimals: 8,
    underlying: USDTToken,
  },
]
const CUSDCVault = {
  address: '0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022',
  symbol: 'cUSDC-VAULT',
  decimals: 8,
  underlying: USDCToken,
}

const CUSDTVault = {
  address: '0x4Be33630F92661afD646081BC29079A38b879aA0',
  symbol: 'cUSDT-VAULT',
  decimals: 8,
  underlying: USDTToken,
}

const fundsHolder = '0x'

const tokens = Object.fromEntries(
  [...sellTokens, CUSDCVault, CUSDTVault].map((i) => [i.address.toLowerCase(), i])
)

const format = (token: { symbol: string; decimals: number }, amount: BigNumberish) => {
  return formatUnits(amount, token.decimals) + ' ' + token.symbol
}

async function main() {
  const EUSDRebalance__factory = await hre.ethers.getContractFactory('EUSDRebalance')
  const DutchTrade = await hre.ethers.getContractFactory('DutchTrade')

  const USDC = await hre.ethers.getContractAt('ERC20Mock', USDCToken.address)
  const USDT = await hre.ethers.getContractAt('ERC20Mock', USDTToken.address)

  const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY_REBALANCER!).connect(
    hre.ethers.provider
  )

  const contract = EUSDRebalance__factory.connect(signer)
  const rebalancerContract = contract.attach(
    '0x171B9c1C18cCA07D731185737001554A021A9dde'
  ) as EUSDRebalance

  let pending = false

  const bmp1 = await hre.ethers.getContractAt(
    'BackingManagerP1',
    '0xF014FEF41cCB703975827C8569a3f0940cFD80A4'
  )
  hre.ethers.provider.on('block', async (blockNumber) => {
    if (pending) {
      return
    }
    console.log('Current Block', blockNumber)
    pending = true

    let activeTrade = false
    for (const sellToken of sellTokens) {
      try {
        const tradeAddr = await bmp1.trades(sellToken.address)
        if (tradeAddr === ZERO_ADDRESS) {
          continue
        }
        const trade = DutchTrade.attach(tradeAddr)
        if ((await trade.status()) === 1) {
          continue
        }
        activeTrade = true
        const state = await rebalancerContract.callStatic.getState(sellToken.address)
        const bidToken = tokens[(await trade.callStatic.buy()).toLowerCase()]
        console.log('Active auction, selling', sellToken.symbol, 'for', bidToken.symbol)

        const price =
          (state.sellAmountUnderlying.toBigInt() * 1000000n) / state.bidAmountUnderlying.toBigInt()

        console.log('Current auction state:')
        console.log('  bid amount  => ' + format(bidToken.underlying, state.bidAmountUnderlying))
        console.log('  sell amount => ' + format(sellToken.underlying, state.sellAmountUnderlying))
        console.log('  price       => ' + format(bidToken.underlying, price))
        console.log('')

        if (state.bidAmountUnderlying.toBigInt() > state.sellAmountUnderlying.toBigInt()) {
          console.log('Waiting for lower price...')
          break
        }

        if (sellToken.underlying !== bidToken.underlying) {
          const [usdcBalance, usdtBalance] = await Promise.all([
            await USDC.balanceOf(fundsHolder),
            await USDT.balanceOf(fundsHolder),
          ])
          console.log('Trading cross tokens. Balances:')
          console.log('  ' + format(USDCToken, usdcBalance))
          console.log('  ' + format(USDTToken, usdtBalance))
        }

        try {
          await rebalancerContract.callStatic.rebalance(fundsHolder, sellToken.address)
        } catch (e: any) {
          break
        }
        console.log('Placing bid!')
        try {
          const tx = (await rebalancerContract.rebalance(fundsHolder, sellToken.address, {
            gasPrice: hre.ethers.provider.getGasPrice().then((i) => i.add(i.div(12).mul(4))),
          })) as TransactionResponse
          console.log('Bid transaction hash: ' + tx.hash)
          const receipt = await tx.wait()
          if (receipt.status === 0) {
            console.log('Transaction hash: ' + tx.hash + ' reverted')
          } else {
            console.log('Transaction hash: ' + tx.hash + ' success')
          }
        } catch (e) {
          console.log('Error trading for', sellToken.symbol)
          console.log(e)
        }
      } catch (e) {}
      break
    }
    pending = false

    if (!activeTrade) {
      console.log('No active trades...')
    }
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
