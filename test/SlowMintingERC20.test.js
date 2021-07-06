const { expect } = require("chai");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe("SlowMintingERC20 contract", function () {

  let SlowMintingERC20;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function () {
    SlowMintingERC20 = await ethers.getContractFactory("SlowMintingERC20Mock");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    cb = await CircuitBreaker.deploy(owner.address);

    Configuration = await ethers.getContractFactory("Configuration");
    conf = await Configuration.deploy([[ZERO_ADDRESS, 0, 0, 0, 0]], [ZERO_ADDRESS, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 25000, 0, cb.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

    token = await SlowMintingERC20.deploy("SlowMintingERC20Token", "SMINT", conf.address);
  });

  describe("Deployment", function () {
    it("Should deploy with no tokens", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      expect(await token.totalSupply()).to.equal(ownerBalance);
      expect(await token.totalSupply()).to.equal(0);

    });

    it("Should start minting", async function () {
      let amount = 1000;
      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount)
    });

    it("Process Mintings in one attempt for amounts smaller than issuance rate", async function () {
      let amount = 1000;
      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      // Check Tokens were minted
      expect(await token.balanceOf(owner.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);

      // Minting again has no impact as queue is empty
      await token["tryProcessMintings()"]();

      // Check Tokens were minted
      expect(await token.balanceOf(owner.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });
  });

});