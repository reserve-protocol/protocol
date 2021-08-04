const { getChainId } = require("../../common/blockchain-utils");

task("deploy-CompoundMath", "Deploys compound math external library")
    .setAction(async taskArgs => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying Compound Math external library")

        // External math lib deployment
        CompoundMath = await ethers.getContractFactory("CompoundMath");
        mathLib = await CompoundMath.connect(deployer).deploy();

        await mathLib.deployed();

        console.log(`CompoundMath library deployed at address: ${mathLib.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${mathLib.deployTransaction.hash}\n`);

        return ({ mathLibraryAddr: mathLib.address });
    })

module.exports = {}
