import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'

const bigIntMax = (...args: BigNumber[]) => args.reduce((m, e) => (e.gt(m) ? e : m))
const bigIntMin = (...args: BigNumber[]) => args.reduce((m, e) => (e.lt(m) ? e : m))

const rTokenAddress = '0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F' // eUSD
// const rTokenAddress = '0xaCdf0DBA4B9839b96221a8487e9ca660a48212be' // hyUSD

async function main() {
  const FacadeRedeemFactory = await hre.ethers.getContractFactory('FacadeRedeem')
  const FacadeRedeem = await FacadeRedeemFactory.deploy().then((e) => e.deployed())

  const baseData = await FacadeRedeem.connect(hre.ethers.provider).callStatic.getBaseInformation(
    rTokenAddress,
    {
      from: ethers.constants.AddressZero,
    }
  )

  console.log({ currentNonce: baseData.currentNonce })
  console.log({ basketsNeeded: baseData.basketsNeeded })

  // Nonces are mapped to their _indexes_ aka, nonce 3 becomes 2, nonce 4 becomes 3 and so on.
  const allValidNonces = Array.from({ length: baseData.currentNonce }, (_, i) => i).filter((e) => {
    // If basket has an erc20 which was unregistered.
    if (
      baseData.erc20s[e].filter((f) => baseData.allErc20s.includes(f)).length !==
      baseData.erc20s[e].length
    ) {
      return false
    }

    // If basket has no erc20s, aka before 3.1.0 release.
    if (baseData.erc20s[e].length === 0) {
      return false
    }

    return true
  })

  console.log({ allValidNonces })

  // Final picked nonces
  const pickedNonces: Record<number, BigNumber> = {}

  // Just temp storage
  const nonceFractions: Record<number, BigNumber> = {}
  const activeBalances = [...baseData.allBalances]

  function getBalanceFor(erc20: string) {
    return activeBalances[baseData.allErc20s.indexOf(erc20)]
  }

  // Worst case, we'll need some fraction of each basket.
  let validNonces = [...allValidNonces]
  while (validNonces.length > 0) {
    for (const nonce of validNonces) {
      const basketFraction = baseData.erc20s[nonce].map((e, i) =>
        baseData.quantities[nonce][i].eq(0)
          ? BigNumber.from(0)
          : getBalanceFor(e).mul(BigNumber.from(10).pow(36)).div(baseData.quantities[nonce][i])
      )

      const basketFractionRatio = basketFraction.map((e) => e.div(baseData.basketsNeeded))

      //   console.log(basketFraction, basketFractionRatio)

      nonceFractions[nonce] = bigIntMin(...basketFractionRatio)

      //   if (nonceFractions[nonce].eq(0)) {
      //     // remove fraction if it gives Infinity, it just means the list was empty.
      //     validNonces = validNonces.filter((e) => e !== nonce)
      //   }

      //   console.log(basketFraction, basketFractionRatio, nonceFractions[nonce])
    }

    // Let's pick the nonce with the max redemption value.
    const chosenNonce = validNonces.find(
      (e) => nonceFractions[e] == bigIntMax(...validNonces.map((e) => nonceFractions[e]))
    )!
    pickedNonces[chosenNonce] = nonceFractions[chosenNonce]

    // console.log({ chosenNonce })
    // console.log(baseData.quantities[chosenNonce])

    baseData.erc20s[chosenNonce].forEach((e, i) => {
      //   console.log(getBalanceFor(e))
      //   console.log(
      //     baseData.quantities[chosenNonce][i]
      //       .mul(nonceFractions[chosenNonce])
      //       .mul(baseData.basketsNeeded)
      //       .div(BigNumber.from(10).pow(36))
      //   )

      activeBalances[baseData.allErc20s.indexOf(e)] = getBalanceFor(e).sub(
        baseData.quantities[chosenNonce][i]
          .mul(nonceFractions[chosenNonce])
          .mul(baseData.basketsNeeded)
          .div(BigNumber.from(10).pow(36))
      )

      if (getBalanceFor(e).lt(0)) {
        activeBalances[baseData.allErc20s.indexOf(e)] = BigNumber.from(0)
      }

      //   console.log(activeBalances[baseData.allErc20s.indexOf(e)])
      //   console.log('next')
    })

    validNonces = validNonces.filter((e) => e !== chosenNonce)

    // console.log(chosenNonce, nonceFractions[chosenNonce])
  }

  console.log({ pickedNonces })
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
