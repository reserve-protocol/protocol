const { getChainId } = require("../../common/blockchain-utils");

task("deploy-CircuitBreaker", "Deploys a circuit breaker contract")
    .addParam("owner", "Address of the Owner")
    .setAction(async ({ owner }) => {
        const [deployer] = await ethers.getSigners();
        const chainId = await getChainId();

        console.log("* Deploying Circuit Breaker")

        CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
        cb = await CircuitBreaker.connect(deployer).deploy(owner);

        await cb.deployed();

        console.log(`Circuit Breaker deployed at address: ${cb.address} on network ${network.name} (${chainId}).`);
        console.log(`Tx: ${cb.deployTransaction.hash}\n`);

        return ({ cbAddr: cb.address });
    })

module.exports = {}
