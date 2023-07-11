import { providers } from 'ethers'
import { ethers } from 'hardhat'
import fs from 'fs'
import { submitBacktest } from './backtester/backtester'
import { hexlify } from 'ethers/lib/utils'
import ExampleBackTest from "./backtester/configs/CurveStableRTokenMetapoolCollateral_stkcvxeUSD3CRVf.json"
type IBacktestType = typeof ExampleBackTest

export const main = async () => {
  const provider = new providers.JsonRpcProvider(process.env.MAINNET_RPC_URL)

  const config = JSON.parse(fs.readFileSync("./scripts/backtester/configs/" + process.env.BACKTEST + ".json", "utf8")) as IBacktestType
  const contractFactory = await ethers.getContractFactory(config.collateralContract)

  const byteCode = contractFactory.bytecode

  const contractInterface = contractFactory.interface

  let erc20Wrapper: {
    byteCode: string
    calls: { data: string }[]
  } | undefined | null = null
  if (config.erc20Wrapper != null) {
    const erc20WrapperFactory = await ethers.getContractFactory(config.erc20Wrapper.contract, config.erc20Wrapper.factoryOptions)
    erc20Wrapper = {
      byteCode: hexlify(erc20WrapperFactory.getDeployTransaction(...config.erc20Wrapper.args).data || []),
      calls: config.erc20Wrapper.calls?.map(call => {
        return {
          data: erc20WrapperFactory.interface.encodeFunctionData(call.method, call.args)
        }
      }) ?? []
    }
  }


  const firstPart = contractInterface._encodeParams(
    contractInterface.deploy.inputs.slice(0, 1),
    [config.collateralConfig]
  )
  const variants = config.variants.map((variant) => {
    const full = contractInterface._encodeParams(
      contractInterface.deploy.inputs,
      [config.collateralConfig, ...variant.args]
    )

    return {
      name: variant.name,
      args: '0x' + full.slice(firstPart.length, full.length)
    }
  })
  
  let start = config.startBlock
  let stride = config.stride
  let numberOfSamples = (config.endBlock - config.startBlock) / stride

  if (process.env.STRIDE != null) {
    stride = parseInt(process.env.STRIDE ?? '1', 10)
    start = parseInt(process.env.START_BLOCK!, 10)

    if (process.env.END_BLOCK === '0') {
      const end = await provider.getBlockNumber()
      numberOfSamples = (end - config.startBlock) / stride
    } else {
      const end = parseInt(process.env.END_BLOCK!, 10)
      numberOfSamples = (end - config.startBlock) / stride
    }
  }

  const result = await submitBacktest(
    process.env.BACKTEST_SERVICE_URL!,
    {
      startBlock: start,
      stride,
      samples: numberOfSamples,
      byteCode: byteCode,
      config: config.collateralConfig,
      erc20Wrapper: erc20Wrapper,
      variants
    }
  )

  console.log(JSON.stringify(result, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
