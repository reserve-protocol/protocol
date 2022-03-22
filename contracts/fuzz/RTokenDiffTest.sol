// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p1/RToken.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/fuzz/Mocks.sol";
import "contracts/fuzz/Utils.sol";

contract MockBackingManager is IBackingManager, ComponentMock {
    function grantAllowances() external {}

    function manageFunds() external {}

    /// Settle any auctions that can be settled
    function settleTrades() external virtual override {}

    function mintThrough(address recipient, uint256 amount) external {
        main.rToken().mint(recipient, amount);
    }

    function setBasketsNeededThrough(int192 basketsNeeded) external {
        main.rToken().setBasketsNeeded(basketsNeeded);
    }

    function claimAndSweepRewards() external virtual override { }


    /// @return {%} The maximum trade slippage acceptable
    function maxTradeSlippage() external view virtual override returns (int192) { return 1e16; }

    /// @return {UoA} The smallest amount of value worth trading
    function dustAmount() external view virtual override returns (int192) { return 2e20; }

}

contract MockBasketHandler is IBasketHandler, ComponentMock {
    function ensureBasket() external {}
}

contract RTokenTestSystem is MainMock {
    using FixLib for int192;

    constructor(IRToken rToken_) {
        DeploymentParams memory params = defaultParams();
        ConstructorArgs memory args = defaultCtorArgs(params);
        // TODO: Set up so that we're using some sort of basket

        this.init(args);
        basketHandler = new MockBasketHandler();
        basketHandler.initComponent(this, args);

        backingManager = new MockBackingManager();
        backingManager.initComponent(this, args);

        rToken = rToken_;
        rToken.initComponent(this, args);
    }

    function poke() public virtual override {
        basketHandler.ensureBasket(); // maaaaaaybe
        backingManager.settleTraders(); // maaaaaybe?
        // sometimes tokens
    }
}

contract RTokenP0Test is RTokenP0 {
    // constructor?
    constructor(
        string memory name_,
        string memory symbol_,
        string memory constitution_
    ) RTokenP0(name_, symbol_, constitution_) {}

    function _msgSender() internal view virtual override returns (address) {
        return main.sender;
    }
}

contract RTokenP1Test is RToken {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory constitution_
    ) RToken(name_, symbol_, constitution_) {}

    function _msgSender() internal view virtual override returns (address) {
        return main.sender;
    }
}

contract RTokenDiffTest {
    using FixLib for int192;
    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    IMain public p0;
    IMain public p1;

    modifier fromSender() {
        p0.setSender(msg.sender);
        p1.setSender(msg.sender);
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    modifier fromBackingMgr() {
        p0.setSender(p0.backingManager());
        p1.setSender(p1.backingManager());
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    constructor() {
        p0 = RTokenTestSystem(new RTokenP0Test());
        p1 = RTokenTestSystem(new RTokenP1Test());
    }

    // Actions and state modifiers
    // TODO: assert that all return values are correct
    // TODO: decorate with events for clues about test failures?

    // ==== user actions, performed by 0x[123]0000. Melt
    function issue(uint256 amount) external fromSender returns (uint256[] memory deposits) {
        uint256[] memory deposits1;
        deposits = p0.rToken().issue(amount);
        deposits1 = p1.rToken().issue(amount);

        assert(deposits.length = deposits1.length);
        for (uint256 i = 0; i < deposits.length; i++) assert(deposits[i] == deposits1[i]);
    }

    function cancel(uint256 endId, bool e) external fromSender returns (uint256[] memory ds) {
        p0.rToken().cancel(endId, e);
        p1.rToken().cancel(endId, e);
    }

    function vest(address account, uint256 endId) external fromSender returns (uint256 vested) {
        p0.rToken().vest(account, endId);
        p1.rToken().vest(account, endId);
    }

    // TODO: Add "cancel" and "vest" variations that are likely to succeed too
    // i.e, ones that have valid endIDs
    function redeem(uint256 amount) external fromSender returns (uint256[] memory compensation) {
        p0.rToken().redeem(amount);
        p1.rToken().redeem(amount);
    }

    function melt(uint256 amount) external fromSender {
        p0.rToken().melt(amount);
        p1.rToken().melt(amount);
    }

    function mint(address recipient, uint256 amount) external fromBackingMgr {
        p0.rToken().mint(recipient, amount);
        p1.rToken().mint(recipient, amount);
    }

    function setBasketsNeeded(int192 basketsNeeded) external fromBackingMgr {
        p0.rToken().setBasketsNeeded(basketsNeeded);
        p1.rToken().setBasketsNeeded(basketsNeeded);
    }

    // Auth on these is that the caller needs to be main.owner. That... should be this contract?
    function setIssuanceRate(int192 val) external {
        assert(p0.owner == address(this)); // hope but verify
        assert(p1.owner == address(this));
        p0.rToken().setIssuanceRate(val);
        p1.rToken().setIssuanceRate(val);
    }

    // TODO: changes to MockERC20 balances

    // Invariant: the observable rtoken prices are equal
    function echidna_prices_equal() external returns (bool) {
        return p0.rToken().price() == p1.rToken().price();
    }

}
