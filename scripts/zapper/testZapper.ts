import { ethers } from "ethers";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers/lib/utils";
import hre from "hardhat";
import fetch from "isomorphic-fetch";
import { impersonateAccount, mine, setCode, setNextBlockBaseFeePerGas } from "@nomicfoundation/hardhat-network-helpers";
import { ERC20Mock } from "@typechain/ERC20Mock";
import ERC20MockArtifact from "../../artifacts/contracts/plugins/mocks/ERC20Mock.sol/ERC20Mock.json"
const basketTokens = [
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x4fabb145d64652a948d72533023f6e7a623c7c53"
]

interface QuoteResponse {
  toTokenAmount: string
  fromTokenAmount: string
  estimatedGas: number
}

const oneInchQuote = async (
  tokenIn: string,
  tokenOut: string,
  amountIn: ethers.BigNumber
) => {
  const resp = await fetch(
    `https://api.1inch.io/v5.0/1/quote?fromTokenAddress=${tokenIn}&toTokenAddress=${tokenOut}&amount=${amountIn.toString()}`
  )
  const out = await resp.json()
  return out as QuoteResponse
}

interface SwapResponse {
  tx: {
    data: string
  }
}

const oneInchSwap = async (
  userAddr: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: ethers.BigNumber,
  slippage: number,
  zapper: string
) => {
  console.log(`https://api.1inch.io/v5.0/1/swap?fromAddress=${userAddr}&fromTokenAddress=${tokenIn}&toTokenAddress=${tokenOut}&amount=${amountIn.toString()}&slippage=${slippage}`)
  const resp = await fetch(
    `https://api.1inch.io/v5.0/1/swap?destReceiver=${zapper}&fromAddress=${userAddr}&fromTokenAddress=${tokenIn}&toTokenAddress=${tokenOut}&amount=${amountIn.toString()}&slippage=${slippage}`
  )
  const out = await resp.json()
  return out as SwapResponse
}

const basketTokensToAmountIn = async (
  inputToken: string,
  basketAmounts: { basketToken: string, amount: ethers.BigNumber }[]
) => {
  const quotes = await Promise.all(basketAmounts.map(async ({ basketToken, amount }) => {
    return oneInchQuote(
      basketToken,
      inputToken,
      amount
    )
  }))
  let totalAmountIn = ethers.constants.Zero
  for (const quote of quotes) {
    totalAmountIn = totalAmountIn.add(quote.toTokenAmount)
  }
  return totalAmountIn
}

async function main() {
  await setNextBlockBaseFeePerGas(parseUnits("0.1", "gwei"))
  await mine(1);
  const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL)
  const network = await provider.getNetwork()
  if (hre.network.name !== 'hardhat') {
    throw new Error("Pls only test against forked network")
  }
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl:
            process.env.MAINNET_RPC_URL,
        },
      },
    ],
  });

  const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  const inputTokenAddr = "0xdac17f958d2ee523a2206206994597c13d831ec7"
  const user = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"
  const userWantsRTokenSum = parseEther("1000");

  const ERC20 = await hre.ethers.getContractFactory("ERC20Mock")
  const Zapper = await hre.ethers.getContractFactory("Zapper");
  const DemoRToken = await hre.ethers.getContractFactory("DemoRToken");
  const rToken = await DemoRToken.deploy();
  const DemoBasketHandler = await hre.ethers.getContractFactory("DemoBasketHandler");
  const basketHandler = await DemoBasketHandler.deploy();
  const zapperInst = await Zapper.deploy(
    weth
  );
  const inputToken = ERC20.attach(inputTokenAddr)
  const inputTokenSymbol = await inputToken.symbol()
  const inputTokenDecimals = await inputToken.decimals()
  const inputBal = await inputToken.balanceOf(user);
  console.log("Input token balance", inputBal, inputTokenSymbol)

  console.log(
    `User wants ${formatEther(userWantsRTokenSum)} RTokens`
  )

  console.log(
    `User 'hodls' ${inputTokenSymbol} tokens`
  )

  const basketAmounts = await zapperInst.callStatic.getInputTokens(
    userWantsRTokenSum,
    basketHandler.address,
    rToken.address
  );
  const reverseQuoteInput = basketAmounts.tokens.map((basketToken, i) => ({ basketToken, amount: basketAmounts.amounts[i] }))
  for (const reserveQuote of reverseQuoteInput) {
    console.log(`Needs ${reserveQuote.basketToken} ${reserveQuote.amount.toString()}`)
  }
  const reverseQuoteSum = await basketTokensToAmountIn(inputToken.address, reverseQuoteInput)

  // Add 1% slippage
  const amountIn = reverseQuoteSum.add(reverseQuoteSum.div(100));

  console.log(
    `User would have to pay approx ~${formatUnits(amountIn, inputTokenDecimals)} ${inputTokenSymbol}`
  )


  console.log("Generating trades")

  const trades = await Promise.all(
    reverseQuoteInput.map(async i => ({
      aggregatorCall: (await oneInchSwap(
        user,
        inputToken.address,
        i.basketToken,
        amountIn.div(
          basketAmounts.tokens.length
        ),
        0.5,
        zapperInst.address
      )).tx.data.toLowerCase(),
      basketToken: i.basketToken
    }))
  )

  console.log(`Balance before: ${formatEther(await rToken.balanceOf(user))} RSV`)
  await hre.ethers.provider.getSigner(0).sendTransaction({
    to: user,
    value: parseEther("100"),
  })
  await impersonateAccount(user)
  await mine()
  const signer = await hre.ethers.getSigner(user)
  console.log("Approving tokens for use with Zapper")
  await inputToken.connect(signer).approve(zapperInst.address, inputBal, {
    gasLimit: 200000
  })
  console.log("Zapping")
  let tx = await zapperInst.connect(signer).zapERC20({
    amountIn: amountIn,
    tokenIn: inputToken.address,
    tokenOut: rToken.address,
    trades,
    amountOut: userWantsRTokenSum,
  }, {
    gasLimit: 2000000
  })
  
  console.log(`Balance after: ${formatEther(await rToken.balanceOf(user))} RSV`)
  console.log(`input token balance ${formatUnits(await inputToken.balanceOf(user), inputTokenDecimals)} ${inputTokenSymbol}`)
  console.log("Gas used needed", (await tx.wait()).gasUsed.toString())

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
