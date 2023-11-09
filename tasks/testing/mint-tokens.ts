import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../scripts/deployment/common'
import { whileImpersonating } from '#/utils/impersonation'
import { bn, fp } from '#/common/numbers'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { anvilSetCode, pushOraclesForward } from './upgrade-checker-utils/oracles'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { EACAggregatorProxy } from '@typechain/EACAggregatorProxy'
import { network } from 'hardhat'

task('mint-tokens', 'Mints all the tokens to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    if (!params.noOutput) {
      console.log(
        `Minting the tokens we've mocked on ${hre.network.name} (${chainId}) to account ${params.address}...`
      )
    }

    const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
    const assetCollDeployments = <IAssetCollDeployments>(
      getDeploymentFile(assetCollDeploymentFilename)
    )

    const tokens = [
      'DAI',
      'USDC',
      'USDT',
      'BUSD',
      'USDP',
      'TUSD',
      'aDAI',
      'aUSDC',
      'aUSDT',
      'aBUSD',
      'cDAI',
      'cUSDC',
      'cETH',
      'cWBTC',
      'AAVE',
      'stkAAVE',
      'COMP',
      'WETH',
      'WBTC',
      'EURT',
      'RSR',
    ]

    for (const token of tokens) {
      const networkTokens = networkConfig[chainId].tokens
      const addr = networkTokens[token as keyof typeof networkTokens]
      const tok = await hre.ethers.getContractAt('ERC20Mock', addr as string)
      const decimals = await tok.decimals()
      const amt = hre.ethers.BigNumber.from('10').pow(decimals + 9)
      console.log(`Minting ${amt} of ${token}`)

      // For ATokens, mint staticAToken balances
      if (token.indexOf('a') == 0) {
        await (await tok.connect(deployer).mint(deployer.address, amt.toString())).wait()

        const collateral = assetCollDeployments.collateral
        const collAddr = collateral[token as keyof typeof collateral] as string
        const coll = await hre.ethers.getContractAt('IAsset', collAddr)
        const staticAToken = await hre.ethers.getContractAt('StaticATokenLM', await coll.erc20())

        console.log(`Approving a ${amt} ${token} deposit`)
        await (await tok.connect(deployer).approve(staticAToken.address, amt.toString())).wait()

        console.log(`Depositing into ${await staticAToken.symbol()} at address ${collAddr}`)
        await (
          await staticAToken.connect(deployer).deposit(deployer.address, amt.toString(), 0, false)
        ).wait()

        await staticAToken.transfer(params.address, amt.toString()) // don't need to wait
      } else {
        await tok.connect(deployer).mint(params.address, amt.toString()) // don't need to wait
      }

      // Sleep 0.5s
      await new Promise((r) => setTimeout(r, 500))
    }

    if (!params.noOutput) {
      console.log(
        `Minted the tokens we've mocked on ${hre.network.name} (${chainId}) to account ${params.address}`
      )
    }
  })

task('give-rsr', 'Mints RSR to an address on a tenderly fork')
  .addParam('address', 'Ethereum address to receive the tokens')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const rsr = await hre.ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.RSR!)

    const rsrWhale = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'
    await whileImpersonating(hre, rsrWhale, async (signer) => {
      await rsr.connect(signer).transfer(params.address, fp('1000e6'))
    })

    console.log(`1000m RSR sent to ${params.address}`)
  })

task('send-eth', 'Sends ETH to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .setAction(async (params, hre) => {
    await hre.network.provider.request({
      method: "anvil_setBalance",
      params: [params.address, "0xfffffffffffffffffff"],
    });

    await hre.network.provider.send('evm_mine', []);

    console.log(`100 ETH sent to ${params.address}`)
  })

task('get-cusdc', 'Sends ETH to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const cusdc = await hre.ethers.getContractAt('CometMainInterface', '0xc3d688B66703497DAA19211EEdff47f25384cdc3')
    const usdc = await hre.ethers.getContractAt('ERC20Mock', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

    const bal = await usdc.balanceOf(params.address)
    await usdc.approve(cusdc.address, bal)
    console.log(`approved cusdc to ${cusdc.address}`, await usdc.balanceOf(params.address), bal)
    await cusdc.supply(usdc.address, bal)
    console.log(`sent ${bal} cUSDC to ${params.address}`)
  })

task('send-wcusdc', 'Sends ETH to an address')
  .addParam('address', 'Ethereum address to receive the tokens')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const wcusdc = await hre.ethers.getContractAt('CusdcV3Wrapper', '0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab')
    const bal = await wcusdc.balanceOf('0x0Ea1f556fe149cBc75C25C12C9A804937144fbf2')
    console.log(`transfer ${bal} wcUSDC to 0x0Ea1f556fe149cBc75C25C12C9A804937144fbf2`)
    await wcusdc.transfer('0x0Ea1f556fe149cBc75C25C12C9A804937144fbf2', bal)
  })

task('status', 'get rtoken status')
  .addParam('address', 'address of the rtoken')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const rtoken = await hre.ethers.getContractAt('RTokenP1', params.address)
    const main = await hre.ethers.getContractAt('MainP1', await rtoken.main())
    const bh = await hre.ethers.getContractAt('BasketHandlerP1', await main.basketHandler())
    const ar = await hre.ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())
    await ar.refresh()

    const erc20s = await ar.erc20s()
    for (const erc20 of erc20s) {
      try {
        const collAddr = await ar.toColl(erc20)
        const coll = await hre.ethers.getContractAt('ICollateral', collAddr)
        console.log(`${erc20} ${collAddr} ${await coll.status()}`)
      } catch (e) {
        continue
      }
    }

    // console.log(await bh.status(), await bh.isReady())
    // await usdc.approve(cusdc.address, bn('20000e6'))
    // console.log(`approved cusdc to ${cusdc.address}`, await usdc.balanceOf(params.address), bn('20000e6'))
    // await cusdc.supply(usdc.address, bn('20000e6'))
    // console.log(`sent ${bn('20000e6')} cUSDC to ${params.address}`)
  })

task('mint', 'get rtoken status')
  .addParam('address', 'address of the rtoken')
  .setAction(async (params, hre) => {
    // await usdc.approve(cusdc.address, bn('20000e6'))
    // console.log(`approved cusdc to ${cusdc.address}`, await usdc.balanceOf(params.address), bn('20000e6'))
    // await cusdc.supply(usdc.address, bn('20000e6'))
    // console.log(`sent ${bn('20000e6')} cUSDC to ${params.address}`)
    const token = await hre.ethers.getContractAt('ERC20Mock', "0xdac17f958d2ee523a2206206994597c13d831ec7")
    const usdtWhale = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"
    console.log('impersonate')
    await whileImpersonating(hre, usdtWhale, async (signer) => {
      console.log('try to transfer')
      await token.connect(signer).transfer(params.address, bn('500000e6'))
    })
  })

task('push')
  .addParam('address', 'address of the rtoken')
  .setAction(async (params, hre) => {
    await pushOraclesForward(hre, params.address)
    // await usdc.approve(cusdc.address, bn('20000e6'))
    // console.log(`approved cusdc to ${cusdc.address}`, await usdc.balanceOf(params.address), bn('20000e6'))
    // await cusdc.supply(usdc.address, bn('20000e6'))
    // console.log(`sent ${bn('20000e6')} cUSDC to ${params.address}`)
  })

task('fix')
  .setAction(async (params, hre) => {
    const overrideOracle = async (
      hre: HardhatRuntimeEnvironment,
      oracleAddress: string
    ): Promise<EACAggregatorProxy> => {
      const daiOracle = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
      const bytecode = await hre.network.provider.send('eth_getCode', [daiOracle, "latest"])
      await anvilSetCode(hre, oracleAddress, bytecode)
      return hre.ethers.getContractAt('EACAggregatorProxyMock', oracleAddress)
    }
    
    async function anvilSetCode(hre: HardhatRuntimeEnvironment, address: string, code: string): Promise<void> {
      await hre.ethers.provider.send(
        "anvil_setCode",
        [address, code],
      );
    }

    await overrideOracle(hre, '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6')
    // await pushOraclesForward(hre, params.address)
    // await usdc.approve(cusdc.address, bn('20000e6'))
    // console.log(`approved cusdc to ${cusdc.address}`, await usdc.balanceOf(params.address), bn('20000e6'))
    // await cusdc.supply(usdc.address, bn('20000e6'))
    // console.log(`sent ${bn('20000e6')} cUSDC to ${params.address}`)
  })

task('execute', 'Sends ETH to an address')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const gove = await hre.ethers.getContractAt('Governance', '0xc837C557071D604bCb1058c8c4891ddBe8FDD630')
    await gove.execute(["0xbcd2719e4862d1eb32a36e8c956d3118ebb2f511","0x162587b5b4c01d26afafd4a1cca61cdc632c9508","0x162587b5b4c01d26afafd4a1cca61cdc632c9508"], ["0","0","0"], ["0x4420e48600000000000000000000000058d7bf13d3572b08de5d96373b8097d94b1325ad","0xef2b9337000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000007f7b77e49d5b30445f222764a794afe14af062eb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000006f05b59d3b20000","0x8a55015b"], "0xea83544bbbd4bb5898a13649e7984d439656cf31f1fa9af125d21faca6a0a45f")
  })

task('ping', 'check something')
  .addParam('address', 'Ethereum address to receive the tokens')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)
    // const user = "0x20b414557846dFb1D6B49AF183aCf4D2F651cc15"
    const user = "0x608e1e01EF072c15E5Da7235ce793f4d24eCa67B"

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    const rtoken = await hre.ethers.getContractAt('RTokenP1', params.address)
    const main = await rtoken.main()
    const mainContract = await hre.ethers.getContractAt('MainP1', main)
    const bh = await mainContract.basketHandler()
    const bhContract = await hre.ethers.getContractAt('BasketHandlerP1', bh)
    console.log(await bhContract.getPrimeBasket())

    const wsteth = await hre.ethers.getContractAt('ERC20Mock', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0')
    const reth = await hre.ethers.getContractAt('ERC20Mock', '0xae78736Cd615f374D3085123A210448E74Fc6393')

    // console.log('bals', await wsteth.balanceOf(user), await reth.balanceOf(user))

    const wstethCollateral = await hre.ethers.getContractAt('FiatCollateral', '0x29F2EB4A0D3dC211BB488E9aBe12740cafBCc49C')
    const rethCollateral = await hre.ethers.getContractAt('FiatCollateral', '0x1103851D1FCDD3f88096fbed812c8FF01949cF9d')
    // console.log('refPerTok', await wstethCollateral.price(), await rethCollateral.price())
    // await wstethCollateral.refresh()
    // await rethCollateral.refresh()
    // console.log('status', await wstethCollateral.status(), await rethCollateral.status(), await bhContract.status())
    // const basket = await bhContract.getPrimeBasket()
    // const ar = await hre.ethers.getContractAt('AssetRegistryP1', await mainContract.assetRegistry())
    // const erc20s = await ar.erc20s()
    // for (const erc20 of erc20s) {
    //   const collAddr = await ar.toAsset(erc20)
    //   const coll = await hre.ethers.getContractAt('FiatCollateral', collAddr)

    //   // console.log(erc20, await coll.status(), await coll.price())
    //   console.log(erc20)
    //   // try {
    //   //   const status = await coll.status()
    //   //   console.log(status)
    //   // } catch (e) {
    //   // }
    // }

    // // create factory and deploy bh
    // const factory = await hre.ethers.getContractFactory('BasketHandlerP1', { libraries: { BasketLibP1: '0xA87e9DAe6E9EA5B2Be858686CC6c21B953BfE0B8'}})
    // const newBh = await factory.deploy()
    // await newBh.deployed()
    // console.log('new bh', newBh.address)
    // // get code / set code
    // const bytecode = await hre.network.provider.send('eth_getCode', [newBh.address, "latest"])
    // await anvilSetCode(hre, bh, bytecode)

    // await bhContract.refreshBasket()
    // const statusStuff = await bhContract.getPrivates()
    // console.log(statusStuff)
  })