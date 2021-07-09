const { expect } = require("chai");
const { ZERO_ADDRESS } = require("./utils/constants");
const { advanceTime } = require("./utils/time");
const { BigNumber } = require("ethers");


describe("SlowMintingERC20 contract", function () {
  beforeEach(async function () {
    SlowMintingERC20 = await ethers.getContractFactory("SlowMintingERC20Mock");
    [owner, addr1, addr2] = await ethers.getSigners();

    CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    cb = await CircuitBreaker.deploy(owner.address);

    Configuration = await ethers.getContractFactory("Configuration");
    conf = await Configuration.deploy([[ZERO_ADDRESS, 0, 0, 0, 0]], [ZERO_ADDRESS, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, BigNumber.from(25000), 0, cb.address, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

    token = await SlowMintingERC20.deploy("SlowMintingERC20Token", "SMINT", conf.address);
  });

  describe("Deployment", function () {
    it("Should deploy with no tokens", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      expect(await token.totalSupply()).to.equal(ownerBalance);
      expect(await token.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should start minting", async function () {
      let amount = BigNumber.from(1000);
      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount)
    });

    it("Should process Mintings in one attempt for amounts smaller than issuance rate", async function () {
      let amount = BigNumber.from(1000);
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

    it("Should process Mintings in multiple attempts (2 blocks)", async function () {
      let amount = BigNumber.from(50000);
      let issuanceRate = await token.issuanceRate();
      let blocks = amount / issuanceRate;

      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens not minted until two blocks have passed
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      // Tokens minted
      expect(await token.balanceOf(owner.address)).to.equal(amount);
      expect(await token.balanceOf(owner.address)).to.equal(blocks * issuanceRate);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("Should process Mintings in multiple attempts (3 blocks)", async function () {
      let amount = BigNumber.from(74000);
      let issuanceRate = await token.issuanceRate();
      let blocks = amount / issuanceRate;
      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens not minted until three blocks have passed
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens not minted until three blocks have passed
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      // Tokens minted
      expect(await token.balanceOf(owner.address)).to.equal(amount);
      expect(await token.balanceOf(owner.address)).to.equal(blocks * issuanceRate);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("Should process multiple Mintings in queue in single issuance", async function () {
      let amount1 = BigNumber.from(2000);
      let amount2 = BigNumber.from(3000);
      let amount3 = BigNumber.from(5000);
      let amount4 = BigNumber.from(6000);

      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      await expect(token.startMinting(owner.address, amount3))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount3);

      await expect(token.startMinting(owner.address, amount4))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount4);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted in single issuance
      expect(await token.balanceOf(owner.address)).to.equal(amount1.add(amount2).add(amount3).add(amount4));
      expect(await token.totalSupply()).to.equal(amount1.add(amount2).add(amount3).add(amount4));
    });

    it("Should process multiple Mintings in queue until exceeding rate", async function () {
      let amount1 = BigNumber.from(10000);
      let amount2 = BigNumber.from(15000);
      let amount3 = BigNumber.from(20000);

      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      await expect(token.startMinting(owner.address, amount3))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount3);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted in single issuance
      expect(await token.balanceOf(owner.address)).to.equal(amount1.add(amount2));
      expect(await token.totalSupply()).to.equal(amount1.add(amount2));
    });

    it("Should process multiple Mintings in multiple issuances", async function () {
      let amount1 = BigNumber.from(60000);
      let amount2 = BigNumber.from(20000);

      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  No tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);


      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted for first mint
      expect(await token.balanceOf(owner.address)).to.equal(amount1);
      expect(await token.totalSupply()).to.equal(amount1);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted for second mint
      expect(await token.balanceOf(owner.address)).to.equal(amount1.add(amount2));
      expect(await token.totalSupply()).to.equal(amount1.add(amount2));
    });

    it("Should process Mintings and count all mined blocks in between", async function () {
      let amount = BigNumber.from(80000);

      // Mine block
      await advanceTime(60);

      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);

      // Mine block
      await advanceTime(60);

      // Mine another block
      await advanceTime(60);

      // Mine a third  block
      await advanceTime(60);

      // Process Mintings - Now its the 4th block - Should mint
      await token["tryProcessMintings()"]();

      // Mine block
      advanceTime(60);

      //  Tokens minted for first mint
      expect(await token.balanceOf(owner.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("Should process Mintings on transfer", async function () {
      const amount = BigNumber.from(10000);
      const transferAmount = BigNumber.from(500);

      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Perform transfer
      await token.connect(owner).transfer(addr1.address, transferAmount);

      //  Tokens minted
      expect(await token.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("Should process Mintings on transferFrom", async function () {
      const amount1 = BigNumber.from(10000);
      const amount2 = BigNumber.from(10000);
      const transferAmount = BigNumber.from(500);

      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Set allowance and transfer
      await token.connect(owner).approve(addr1.address, transferAmount);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, transferAmount);

      //  Tokens minted
      expect(await token.balanceOf(owner.address)).to.equal(amount1.add(amount2).sub(transferAmount));
      expect(await token.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await token.totalSupply()).to.equal(amount1.add(amount2));
    });

    it("Should process Mintings on relayedTransfer", async function () {
      const amount = BigNumber.from(10000);
      const transferAmount = BigNumber.from(500);

      await expect(token.startMinting(owner.address, amount))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount);;

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Perform Relayed transfer
      // Transfer 50 tokens from owner to addr1, relayed by another account
      const nonce = await token.relayNonce(owner.address);
      const hash = ethers.utils.solidityKeccak256(
        ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        ["relayedTransfer", token.address, owner.address, addr1.address, transferAmount, 0, nonce]
      );
      const sigHashBytes = ethers.utils.arrayify(hash);
      const sig = await owner.signMessage(sigHashBytes)

      await expect(token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, transferAmount, 0))
        .to.emit(token, 'TransferForwarded')
        .withArgs(sig, owner.address, addr1.address, transferAmount, 0);

      //  Tokens minted
      expect(await token.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);
      expect(await token.totalSupply()).to.equal(amount);
    });
  });
});
