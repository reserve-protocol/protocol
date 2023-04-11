import { bn } from "#/common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import { formatEther } from "ethers/lib/utils"
import { HardhatRuntimeEnvironment } from "hardhat/types"

type Balances = { [key: string]: BigNumber }

const getAccountBalances = async (
  hre: HardhatRuntimeEnvironment,
  account: string,
  erc20s: Array<string>
): Promise<Balances> => {
  const balances: Balances = {}
  for (const erc20 of erc20s) {
    const token = await hre.ethers.getContractAt('ERC20Mock', erc20)
    const bal = await token.balanceOf(account)
    balances[erc20] = bal
  }
  return balances
}

const closeTo = (x: BigNumber, y: BigNumber, eBps: BigNumber): boolean => {
  return x.sub(y).abs().lte(x.add(y).div(2).mul(eBps).div(10000))
}

export const redeemRTokens = async (
    hre: HardhatRuntimeEnvironment,
    user: SignerWithAddress,
    rTokenAddress: string,
    redeemAmount: BigNumber
  ) => {
    console.log(`\nRedeeming ${formatEther(redeemAmount)}...`)
    const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
    const main = await hre.ethers.getContractAt('IMain', await rToken.main())
    const basketHandler = await hre.ethers.getContractAt(
      'BasketHandlerP1',
      await main.basketHandler()
    )
  
    const redeemQuote = await basketHandler.quote(redeemAmount, 0)
    const expectedTokens = redeemQuote.erc20s
    const expectedBalances: Balances = {}
    let log = ''
    for (const erc20 in expectedTokens) {
      expectedBalances[expectedTokens[erc20]] = redeemQuote.quantities[erc20]
      log += `\n\t${expectedTokens[erc20]}: ${redeemQuote.quantities[erc20]}`
    }
    console.log(`Expecting to receive: ${log}`)
  
    const preRedeemRTokenBal = await rToken.balanceOf(user.address)
    const preRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)
    await rToken.connect(user).redeem(redeemAmount, await basketHandler.nonce())
    const postRedeemRTokenBal = await rToken.balanceOf(user.address)
    const postRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)
  
    for (const erc20 of expectedTokens) {
      const receivedBalance = postRedeemErc20Bals[erc20].sub(preRedeemErc20Bals[erc20])
      if (!closeTo(receivedBalance, expectedBalances[erc20], bn(1))) {
        throw new Error(
          `Did not receive the correct amount of token from redemption \n token: ${erc20} \n received: ${receivedBalance} \n expected: ${expectedBalances[erc20]}`
        )
      }
    }
  
    if (!preRedeemRTokenBal.sub(postRedeemRTokenBal).eq(redeemAmount)) {
      throw new Error(
        `Did not redeem the correct amount of RTokens \n expected: ${redeemAmount} \n redeemed: ${postRedeemRTokenBal.sub(
          preRedeemRTokenBal
        )}`
      )
    }
  
    console.log(`successfully redeemed ${formatEther(redeemAmount)} RTokens`)
  }