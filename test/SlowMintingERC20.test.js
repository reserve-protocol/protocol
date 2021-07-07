const { expect } = require("chai");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';


const advanceTime = async (seconds) => {
  await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())]);
  await ethers.provider.send('evm_mine', []);
};


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

    it("Process Mintings in multiple attempts - 2 blocks", async function () {
      let amount = 50000;
      let issuanceRate = parseInt(await token.issuanceRate());
      let blocks = amount / issuanceRate;

      //console.log(blocks);
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

    it("Process Mintings in multiple attempts - 3 blocks", async function () {
      let amount = 70000;
      let issuanceRate = parseInt(await token.issuanceRate());
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

    it("Process Multiple Mintings in queue in single issuance", async function () {
      let amount1 = 2000;
      let amount2 = 3000;
      let amount3 = 5000;
      let amount4 = 6000;
      
      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount3))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount3);

        //console.log(blocks);
      await expect(token.startMinting(owner.address, amount4))
      .to.emit(token, 'MintingInitiated')
      .withArgs(owner.address, amount4);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted in single issuance
      expect(await token.balanceOf(owner.address)).to.equal(amount1 + amount2 + amount3 + amount4);
      expect(await token.totalSupply()).to.equal(amount1 + amount2 + amount3 + amount4);
      
    });

    it("Process Multiple Mintings in queue in single issuance - excludes exceeding", async function () {
      let amount1 = 10000;
      let amount2 = 15000;
      let amount3 = 20000;
      
      
      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount3))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount3);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted in single issuance
      expect(await token.balanceOf(owner.address)).to.equal(amount1 + amount2);
      expect(await token.totalSupply()).to.equal(amount1 + amount2);
      
    });


    it("Process Multiple Mintings in multiple issuances", async function () {
      let amount1 = 60000;
      let amount2 = 20000;
      // let issuanceRate = parseInt(await token.issuanceRate());
      // let blocks = amount1 / issuanceRate;
      // console.log("Blocks: " + blocks);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount1))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount1);

      //console.log(blocks);
      await expect(token.startMinting(owner.address, amount2))
        .to.emit(token, 'MintingInitiated')
        .withArgs(owner.address, amount2);

      // No Tokens minted yet
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);

      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted for second mint
      expect(await token.balanceOf(owner.address)).to.equal(0);
      expect(await token.totalSupply()).to.equal(0);


      // Process Mintings
      await token["tryProcessMintings()"]();

      //  Tokens minted for first mint
      expect(await token.balanceOf(owner.address)).to.equal(amount1);
      expect(await token.totalSupply()).to.equal(amount1);
     
       // Process Mintings
       await token["tryProcessMintings()"]();

       //  Tokens minted for first mint
       expect(await token.balanceOf(owner.address)).to.equal(amount1 + amount2);
       expect(await token.totalSupply()).to.equal(amount1 + amount2);
    });
  });


});