import { getChainId } from '#/common/blockchain-utils'
import { formatEther } from 'ethers/lib/utils'
import hre, { ethers } from 'hardhat'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  IAssetCollDeployments,
} from './deployment/common'

// This prints an MD table of all the collateral plugin parameters
// Usage: npx hardhat run --network mainnet scripts/collateral-params.ts
async function main() {
  const header = ['Plugin', 'Peg Tolerance', 'Delay (hrs)', 'Oracle(s)', 'Underlying']
  const body: string[][] = []

  const chainId = await getChainId(hre)
  // Get deployed collateral
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId, 'mainnet-3.0.0')
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const { collateral: collaterals } = assetCollDeployments

  for (const [collateral, address] of Object.entries(collaterals)) {
    const collateralContract = await ethers.getContractAt('FiatCollateral', address)

    const targetPerRef = await collateralContract.targetPerRef()
    const pegBottom = await collateralContract.pegBottom()
    const delay = await collateralContract.delayUntilDefault()
    const underlyingAddr = await collateralContract.erc20()
    const chainlinkFeed = await collateralContract.chainlinkFeed()
    // we cannot read the chainlink feeds for multi-oracle collateral because we used immutable internal vars :(

    const collateralMd = getEtherscanMd(address, collateral)
    const underlyingMd = getEtherscanMd(underlyingAddr)
    const clFeedMd = getEtherscanMd(chainlinkFeed)

    const NEEDS_ATTENTION = ['[cvxMIM3', '[crvMIM3'] // first 8 chars only

    body.push([
      collateralMd,
      `${formatEther(targetPerRef.sub(pegBottom).mul(100))}% ${
        NEEDS_ATTENTION.indexOf(collateralMd.substring(0, 8)) >= 0 ? '(needs attention)' : ''
      }`,
      (delay / 3600).toString(),
      clFeedMd,
      underlyingMd,
    ])
  }
  printTable(header, body)
  console.log(
    'WARNING: FILL IN "(needs attention)" BEFORE BLINDLY SAVING TO docs/plugin-addresses.md'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

// Helper function for printing MD table
// This could've come from a library, but I didn't want to add a dependency
const printTable = (headers: string[], body: string[][]) => {
  const fmtStrLen = (str: string, len: number) => {
    const pre = ' '.repeat(Math.floor((len - str.length) / 2))
    const trail = ' '.repeat(Math.ceil((len - str.length) / 2))
    return pre.concat(str).concat(trail)
  }
  const getFieldLength = (fieldOrder: number) => {
    let len = headers[fieldOrder].length
    body?.forEach((row) => {
      const rowLength = row[fieldOrder]?.length ?? 0
      len = len > rowLength ? len : rowLength
    })
    return Math.ceil((len + 2) / 2) * 2
  }
  const fieldsLengths: number[] = body[0].map((_, idx) => getFieldLength(idx))
  const separator = { horizontal: '-', vertical: '|' }

  headers.forEach((header, idx) =>
    process.stdout.write(separator.vertical + fmtStrLen(header, fieldsLengths[idx]))
  )
  console.log(separator.vertical)

  headers.forEach((_header, _idx) => {
    process.stdout.write(separator.vertical + separator.horizontal.repeat(fieldsLengths[_idx]))
  })
  console.log(separator.vertical)

  body.forEach((row) => {
    row.forEach((field, idx) =>
      process.stdout.write(separator.vertical + fmtStrLen(field ?? '', fieldsLengths[idx]))
    )
    console.log(separator.vertical)
  })
}

const getEtherscanMd = (address: string, name?: string) =>
  `[${name || address}](https://etherscan.io/address/${address})`
