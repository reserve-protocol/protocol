import { providers } from 'ethers'
import { ethers } from 'hardhat'
import fs from 'fs'
import { backTestPlugin } from './backtester/backtester'

const htmlReportTemplate = fs.readFileSync('./scripts/backtester/report-template.html', 'utf8')

export const main = async () => {
  const provider = new providers.JsonRpcProvider(process.env.MAINNET_RPC_URL)

  const currentBlock = await provider.getBlockNumber()
  const stride = parseInt(process.env.STRIDE ?? '300', 10)
  const numberOfSamples = parseInt(process.env.SAMPLES ?? '1000', 10)
  const contractToTest = (
    await ethers.getContractFactory(process.env.CONTRACT_NAME!)
  ).getDeployTransaction(...JSON.parse(process.env.CONSTRUCTOR_PARAMETERS!))

  if (process.env.BACKTEST_RESULT_DIR != null) {
    console.log('Will save results to ', process.env.BACKTEST_RESULT_DIR)
    if (!fs.existsSync(process.env.BACKTEST_RESULT_DIR)) {
      fs.mkdirSync(process.env.BACKTEST_RESULT_DIR)
    }
  }

  const start = currentBlock - stride * numberOfSamples
  const result = {
    ...(
      await backTestPlugin([contractToTest.data!], {
        start,
        stride,
        numberOfSamples,
        backtestServiceUrl: process.env.BACKTEST_SERVICE_URL!,
      })
    )[0],
    backtestName: process.env.CONTRACT_NAME!,
  }

  if (process.env.BACKTEST_RESULT_DIR != null) {
    console.log('Backtest done, saving results')
    console.log(`Saving to ${process.env.BACKTEST_RESULT_DIR}/${process.env.CONTRACT_NAME}.json`)
    fs.writeFileSync(
      `${process.env.BACKTEST_RESULT_DIR}/${result.backtestName}.json`,
      JSON.stringify(result, null, 2)
    )

    const htmlReport = htmlReportTemplate.replace(
      'const data = []',
      'const data = ' + JSON.stringify([result], null, 2)
    )
    fs.writeFileSync(`${process.env.BACKTEST_RESULT_DIR}/report.html`, htmlReport)
  } else {
    console.log(JSON.stringify(result, null, 2))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
