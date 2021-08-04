
const { getChainId } = require("../../common/blockchain-utils");

task("deploy-InsurancePool", "Deploys Insurance Pool Implementation")
    .setAction(async taskArgs => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying Insurance Pool implementation contract")

        // Deploy InsurancePool implementations
        InsurancePool = await ethers.getContractFactory("InsurancePool");
        iPoolImpl = await InsurancePool.connect(deployer).deploy();

        await iPoolImpl.deployed();

        console.log(`Insurance Pool Implementation deployed at address: ${iPoolImpl.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${iPoolImpl.deployTransaction.hash}\n`);

        return ({ iPoolImplAddr: iPoolImpl.address });
    })

module.exports = {}
