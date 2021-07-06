const { expect } = require("chai");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe("Configuration", function() {
    it("Deployment should setup CircuitBreaker and Issuance Rate", async function() {
        const [owner, addr1] = await ethers.getSigners();
       
        const Configuration = await ethers.getContractFactory("Configuration");

        CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
        cb = await CircuitBreaker.deploy(owner.address);
    
        const conf = await Configuration.deploy([[ZERO_ADDRESS,0,0,0,0]],[ZERO_ADDRESS,0,0,0,0],[0,0,0,0,0,0,0,1000,0,cb.address,ZERO_ADDRESS,ZERO_ADDRESS,ZERO_ADDRESS,ZERO_ADDRESS]);
    
        expect(await conf.issuanceRate()).to.equal(1000);
        expect(await conf.circuitBreaker()).to.equal(cb.address);
    });
});
