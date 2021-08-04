
const { getChainId } = require("../../common/blockchain-utils");

task("deploy-RToken", "Deploys RToken Implementation")
    .addParam("mathlib", "Address of the external Compound Math Library")
    .setAction(async ({ mathlib }) => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying RToken implementation contract")

        // Deploy RToken and InsurancePool implementations
        RToken = await ethers.getContractFactory("RToken", {
            libraries: {
                CompoundMath: mathlib
            }
        });

        rTokenImpl = await RToken.connect(deployer).deploy();

        await rTokenImpl.deployed();

        console.log(`RToken Implementation deployed at address: ${rTokenImpl.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${rTokenImpl.deployTransaction.hash}\n`);

        return ({ rTokenImplAddr: rTokenImpl.address });
    })

module.exports = {}
