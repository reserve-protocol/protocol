import hre, { ethers } from 'hardhat'

const supportedNodes = ['anvil', 'hardhat']
const oracleList = [
  '0x759bbc1be8f90ee6457c44abc7d443842a976d02',
  '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
  '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
  '0x833D8Eb16D306ed1FbB5D7A2E019e106B960965A',
  '0x09023c0DA49Aaf8fc3fA3ADF34C6A7016D38D5e3',
  '0xec746eCF986E2927Abd291a2A1716c940100f8Ba',
  '0xad35Bd71b9aFE6e4bDc266B345c198eaDEf9Ad94',
  '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD',
  '0x7A364e8770418566e3eb2001A96116E6138Eb32F',
  '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
  '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
  '0x01D391A48f4F7339aC64CA2c83a07C22F95F587a',
  '0xb49f677943BC038e9857d61E7d053CaA2C1734C1',
  '0x86392dc19c0b719886221c78ab11eb8cf5c52812',
  '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8',
  '0x536218f9E9Eb48863970252233c8F271f554C2d0',
  '0xf017fcb346a1885194689ba23eff2fe6fa5c483b',
  '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23',
]

async function main() {
  const clientVersion = await hre.ethers.provider.send('web3_clientVersion', [])
  const isSupported = supportedNodes.some((node) => clientVersion.toLowerCase().includes(node))
  console.log({ clientVersion, isSupported })

  if (!isSupported) {
    throw Error('Unsupported Network')
  }

  const forkedOracleArtifact = await hre.artifacts.readArtifact('ForkedOracle')

  for (const oracleAddress of oracleList) {
    const oracle = await hre.ethers.getContractAt('ForkedOracle', oracleAddress)

    const description = await oracle.description()
    const decimals = await oracle.decimals()
    const roundData = await oracle.latestRoundData()

    console.log(`-------- Updating ${description} (${oracle.address}) Oracle...`)
    console.log(`>>>> Current Answer:`, ethers.utils.formatUnits(roundData.answer, decimals))

    console.log('>>>> Updating code...')
    await hre.ethers.provider.send('hardhat_setCode', [
      oracle.address,
      forkedOracleArtifact.deployedBytecode,
    ])
    console.log('>>>> Updating data...')
    await oracle.setData(decimals, roundData.answer, {
      gasLimit: 10_000_000,
    })
    console.log('>>>> Done!')
  }
}

main().catch((e) => console.error(e))
