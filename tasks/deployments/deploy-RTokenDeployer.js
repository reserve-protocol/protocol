
const { getChainId } = require("../../common/blockchain-utils");

task("deploy-RTokenDeployer", "Deploys RToken Implementation")
    .addParam("rtoken", "Address of the RToken implementation")
    .addParam("insurancepool", "Address of the Insurance Pool implementation")
    .setAction(async ({ rtoken, insurancepool }) => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying RToken Deployer contract")

        RTokenDeployer = await ethers.getContractFactory("RTokenDeployer");
        tokenDeployer = await RTokenDeployer.connect(deployer).deploy(rtoken, insurancepool);

        await tokenDeployer.deployed();

        console.log(`RToken Deployer deployed at address: ${tokenDeployer.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${tokenDeployer.deployTransaction.hash}\n`);

        return ({ rTokenDeployerAddr: tokenDeployer.address });
    })

module.exports = {}
