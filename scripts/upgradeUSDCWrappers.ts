import { BigNumberish } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'
import hre from 'hardhat'

const loadToken = async (address: string) => {
  const USDC = await hre.ethers.getContractAt('ERC20Mock', address)
  const symbol = await USDC.symbol()
  const decimals = await USDC.decimals()
  return {
    address,
    symbol,
    decimals,
  }
}

const format = (
  token: { symbol: string; decimals: number },
  amount: BigNumberish,
  decimalsOverwrite = token.decimals
) => {
  return formatUnits(amount, decimalsOverwrite) + ' ' + token.symbol
}

async function main() {
  let provider = hre.ethers.provider
  const EUSDRebalance__factory = await hre.ethers.getContractFactory('UpgradeUSDCCompWrappers')
  const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY_REBALANCER!).connect(provider)

  const USDC = await loadToken('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  const FUSDC = await loadToken('0x465a5a630482f3abD6d3b84B39B29b07214d19e5')
  const FUSDC_VAULT = await loadToken('0x6D05CB2CB647B58189FA16f81784C05B4bcd4fe9')
  const OLD_CUSDCV3WRAPPER = await loadToken('0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab')
  const NEW_CUSDCV3WRAPPER = await loadToken('0x093c07787920eB34A0A0c7a09823510725Aee4Af')

  const tokens = Object.fromEntries(
    [USDC, FUSDC, FUSDC_VAULT, OLD_CUSDCV3WRAPPER, NEW_CUSDCV3WRAPPER].map(
      (i) => [i.address, i] as const
    )
  )

  const rebalancerContract = EUSDRebalance__factory.attach('0x000...').connect(signer)

  let pending = false

  hre.ethers.provider.on('block', async (blockNumber) => {
    if (pending) {
      return
    }
    console.log('Current Block', blockNumber)
    pending = true

    let activeTrade = false
    for (const sellToken of [
      // OLD_CUSDCV3WRAPPER,
      FUSDC_VAULT
    ]) {
      //[FUSDC, FUSDC_VAULT, OLD_CUSDCV3WRAPPER, NEW_CUSDCV3WRAPPER]) {
      try {
        const state = await rebalancerContract.callStatic.getState(
          '0xeC11Cf537497141aC820615F4f399be4a1638Af6',
          sellToken.address,
          {
            from: signer.address,
          }
        )
        activeTrade = true
        const buyToken = tokens[state.buy]
        console.log(
          `Active trade for ${format(sellToken, state.sellAmount)} -> ${format(
            buyToken,
            state.bidAmount
          )}`
        )
        console.log(
          `Underlying ${format(USDC, state.sellAmountUnderlying)} -> ${format(
            USDC,
            state.bidAmountUnderlying
          )}`
        )
        console.log(
          `Donation ${format(buyToken, state.donation)} <-> underlying ${format(USDC, state.donationUnderlying)}`
        )
        if (state.bidAmountUnderlying.toBigInt() > state.sellAmountUnderlying.toBigInt()) {
          continue
        }

        try {
          rebalancerContract.callStatic.rebalance(
            '0xeC11Cf537497141aC820615F4f399be4a1638Af6',
            sellToken.address,
          )
        } catch(e){
          console.log(e)
          continue
        }
        console.log('Rebalancing...')
        const tx = await rebalancerContract.rebalance(
          '0xeC11Cf537497141aC820615F4f399be4a1638Af6',
          sellToken.address,
        )
        const receipt = await tx.wait(0)

        if (receipt.status === 0) {
          console.log('Transaction failed')
          continue
        } else {
          console.log('Transaction successful')
        }

        
      } catch (e) {
        console.log(e)
      }
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
