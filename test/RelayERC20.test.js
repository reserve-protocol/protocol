const { expect } = require("chai");

describe("RelayERC20 contract", function () {

  let RelayERC20;
  let token;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function () {
    RelayERC20 = await ethers.getContractFactory("RelayERC20Mock");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    token = await RelayERC20.deploy("RelayToken", "RTKN");
    await token.mint(owner.address, 1000);
  });

  // You can nest describe calls to create subsections.
  describe("Deployment", function () {
    // `it` is another Mocha function. This is the one you use to define your
    // tests. It receives the test name, and a callback function.

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      expect(await token.totalSupply()).to.equal(ownerBalance);
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      // Transfer 50 tokens from owner to addr1
      await token.transfer(addr1.address, 50);
      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50);

      // Transfer 50 tokens from addr1 to addr2
      await token.connect(addr1).transfer(addr2.address, 50);
      const addr2Balance = await token.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50);
    });

    it("Should fail if sender doesn’t have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);

      // Try to send 1 token from addr1 (0 tokens) to owner (1000 tokens).
      await expect(
        token.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      // Owner balance shouldn't have changed.
      expect(await token.balanceOf(owner.address)).to.equal(
        initialOwnerBalance
      );
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);

      // Transfer 100 tokens from owner to addr1.
      await token.transfer(addr1.address, 100);

      // Transfer another 50 tokens from owner to addr2.
      await token.transfer(addr2.address, 50);

      // Check balances.
      const finalOwnerBalance = await token.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance - 150);

      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(100);

      const addr2Balance = await token.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50);
    });
  });

  describe("Relay Transfers", function () {
    it("Should perform relay transfer  between accounts", async function () {
      // Transfer 50 tokens from owner to addr1, relayed by another account
      const nonce = await token.relayNonce(owner.address);

      const hash = ethers.utils.solidityKeccak256(
        ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        ["relayedTransfer", token.address, owner.address, addr1.address, 50, 0, nonce]
      );
      const sigHashBytes = ethers.utils.arrayify(hash);
      const sig = await owner.signMessage(sigHashBytes)

      await expect(token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, 50, 0))
        .to.emit(token, 'TransferForwarded')
        .withArgs(sig, owner.address, addr1.address, 50, 0);


      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50);
    });

    it("Should update nonce correctly and only accept valid nonce", async function () {
      // Transfer 50 tokens from owner to addr1, relayed by another account
      let nonce = await token.relayNonce(owner.address);

      const hash = ethers.utils.solidityKeccak256(
        ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        ["relayedTransfer", token.address, owner.address, addr1.address, 50, 0, nonce]
      );

      const sigHashBytes = ethers.utils.arrayify(hash);
      const sig = await owner.signMessage(sigHashBytes)

      await token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, 50, 0);
      let addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50);

      nonce = await token.relayNonce(owner.address);

      const hash2 = ethers.utils.solidityKeccak256(
        ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        ["relayedTransfer", token.address, owner.address, addr1.address, 20, 0, nonce]
      );

      const sigHashBytes2 = ethers.utils.arrayify(hash2);
      const sig2 = await owner.signMessage(sigHashBytes2)

      await expect(token.connect(addr2).relayedTransfer(sig2, owner.address, addr1.address, 20, 0))
        .to.emit(token, 'TransferForwarded')
        .withArgs(sig2, owner.address, addr1.address, 20, 0);

      addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(70);
    });

    it("Should not relay if invalid signature", async function () {
      // Transfer 50 tokens from owner to addr1, relayed by another account
      const nonce = await token.relayNonce(owner.address);

      const hash = ethers.utils.solidityKeccak256(
        ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
        ["relayedTransfer", token.address, owner.address, addr1.address, 50, 0, nonce]
      );

      const sigHashBytes = ethers.utils.arrayify(hash);
      const sig = await addr2.signMessage(sigHashBytes)

      await expect(
        token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, 50, 0)
      ).to.be.revertedWith("RelayERC20: Invalid signature");

      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(0);
    });
  });
});