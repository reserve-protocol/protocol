const hre = require("hardhat");
const { networkConfig, getRTokenConfig } = require('../common/configuration')
const { getChainId } = require("../common/blockchain-utils");
const { ZERO_ADDRESS, ONE_ETH } = require("../common/constants");

async function main() {
  const [deployer, addr1, addr2] = await ethers.getSigners();
  const chainId = await getChainId();

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${network.name}`);
  }

  console.log(`Starting full deployment on network ${network.name} (${chainId})`);
  console.log(`Deployer account: ${deployer.address}\n`);

  /********************** Deploy RSR ****************************************/
  // Get previous RSR Address
  let previousRSRAddr = networkConfig[chainId]['rsrPrev'];

  // if not configured, deploy mock contract locally
  if (!previousRSRAddr) {

    ({ previousRSRAddr } = await hre.run("deploy-ReserveRightsTokenMock"));
    // Mine some tokens
    prevRSR = await ethers.getContractAt("ReserveRightsTokenMock", previousRSRAddr);
    await prevRSR.mint(addr1.address, ONE_ETH);
    await prevRSR.mint(addr2.address, ONE_ETH);
  }

  // Deploy new RSR
  const slowwallet = networkConfig[chainId]['slowWallet'] || addr1.address;
  const multisigwallet = networkConfig[chainId]['multisigWallet'] || addr2.address;

  const { rsrAddr } = await hre.run("deploy-RSR", { prevrsr: previousRSRAddr, slowwallet, multisigwallet });
  /**************************************************************************/

  /********************** Deploy Math Library *******************************/
  // Deplpy External Math library - Allow configuration to deploy it only once in public networks
  let mathLibraryAddr = networkConfig[chainId]['compoundMath'];
  if (!mathLibraryAddr) {
    ({ mathLibraryAddr } = await hre.run("deploy-CompoundMath"));
  }
  /**************************************************************************/

  /************* Deploy RToken -Insurance Pool   ****************************/
  const { rTokenImplAddr } = await hre.run("deploy-RToken", { mathlib: mathLibraryAddr });
  const { iPoolImplAddr } = await hre.run("deploy-InsurancePool");
  /**************************************************************************/

  /***************** Deploy RToken Deployer *********************************/
  const { rTokenDeployerAddr } = await hre.run("deploy-RTokenDeployer", { rtoken: rTokenImplAddr, insurancepool: iPoolImplAddr });
  /**************************************************************************/

  /***************** Create RToken  *****************************************/
  // Setup Token config
  const rtokenConfig = getRTokenConfig("default");

  // Setup owner
  const owner = networkConfig[chainId]['owner'] || deployer.address;

  // Setup Circuit Breaker
  const { cbAddr } = await hre.run("deploy-CircuitBreaker", { owner });
  rtokenConfig.params.circuitBreaker = cbAddr;

  // Setup basket tokens
  const basketInfo = {
    tokens: rtokenConfig.basketTokens
  };

  // Setup RSR Token Info
  const rsrTokenInfo = rtokenConfig.rsr;
  rsrTokenInfo.tokenAddress = rsrAddr;

  const { rTokenAddr, iPoolAddr } = await hre.run("create-RToken", { tokendeployer: rTokenDeployerAddr, owner, name: rtokenConfig.name, symbol: rtokenConfig.symbol, tokenconfig: rtokenConfig.params, basketinfo: basketInfo, rsrinfo: rsrTokenInfo });

  /**************************************************************************/

  console.log("*********************************************************************");
  console.log(`Deployments completed successfully on network ${network.name} (${chainId})\n`);
  console.log(`RSR:  ${rsrAddr}`);
  console.log(`CompoundMath:  ${mathLibraryAddr}`);
  console.log(`RToken (impl):  ${rTokenImplAddr}`);
  console.log(`InsurancePool (impl):  ${iPoolImplAddr}`);
  console.log(`RToken Deployer:  ${rTokenDeployerAddr}`);
  console.log(`RToken (Default):  ${rTokenAddr}`);
  console.log(`  - InsurancePool:  ${iPoolAddr}`);
  console.log(`  - CircuitBreaker:  ${cbAddr}`);
  console.log(`  - Owner:  ${owner}`);
  console.log("********************************************************************");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });