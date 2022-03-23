// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p1/RToken.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/Mocks.sol";
import "contracts/fuzz/Utils.sol";

contract MockBackingManager is IBackingManager, ComponentMock {
    function grantAllowances() external {}

    function manageFunds() external {}

    /// Settle any auctions that can be settled
    function settleTrades() external virtual override {}

    function claimAndSweepRewards() external virtual override {}

    /// @return {%} The maximum trade slippage acceptable
    function maxTradeSlippage() external view virtual override returns (int192) {
        return 1e16;
    }

    /// @return {UoA} The smallest amount of value worth trading
    function dustAmount() external view virtual override returns (int192) {
        return 2e20;
    }
}

contract MockBasketHandler is IBasketHandler, ComponentMock {
    using FixLib for int192;
    /* The mock basket we're running with, here, is always either 100% A or 100% B.
     * Each is always assumed to have a price of 1 UoA.
     * We can (and maybe should) build something with wider behavior
     */

    // Is the basket 100% A (instead of 100% B?)
    bool public modeA = true;
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public nonce = 0;
    uint256 public timestamp;

    constructor(IERC20 tokenA_, IERC20 tokenB_) {
        tokenA = tokenA_;
        tokenB = tokenB_;
        timestamp = block.timestamp;
    }

    function token() private view returns (IERC20) {
        return modeA ? tokenA : tokenB;
    }

    /// Set the prime basket
    function setPrimeBasket(IERC20[] memory, int192[] memory) external {}

    /// Set the backup configuration for a given target
    function setBackupConfig(
        bytes32,
        uint256,
        IERC20[] calldata
    ) external {}

    /// Try to ensure the current basket is valid, causing underlying updates
    function ensureBasket() external {}

    /// Governance-controlled setter to cause a basket switch explicitly
    function switchBasket() external returns (bool) {
        // TODO: modeA = !modeA, and we do all the needed trades and handle capitalization
        ++nonce;
        timestamp = block.timestamp;
        return false;
    }

    /// @return If the BackingManager has sufficient collateral to redeem the entire RToken supply
    function fullyCapitalized() external view returns (bool) {
        return true;
    }

    /// @return status The worst CollateralStatus of all collateral in the basket
    function status() external view returns (CollateralStatus) {
        return CollateralStatus.SOUND;
    }

    /// @return {tok/BU} The whole token quantity of token in the reference basket
    function quantity(IERC20 erc20) external view returns (int192) {
        return token() == erc20 ? FIX_ONE : FIX_ZERO;
    }

    /// @param amount {BU}
    /// @return erc20s The addresses of the ERC20 tokens in the reference basket
    /// @return quantities {qTok} The quantity of each ERC20 token to issue `amount` baskets
    function quote(int192 amount, RoundingApproach rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        erc20s = new address[](1);
        erc20s[0] = modeA ? address(tokenA) : address(tokenB);
        quantities = new uint256[](1);
        quantities[0] = amount.shiftLeft(18).toUint(rounding);
    }

    /// @return baskets {BU} The quantity of complete baskets at an address. A balance for BUs
    function basketsHeldBy(address acct) external view returns (int192 baskets) {
        baskets = toFix(token().balanceOf(acct));
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price() external view returns (int192 p) {
        return FIX_ONE;
    }

    /// @return nonce_ The basket nonce, a monotonically increasing unique identifier
    /// @return timestamp_ The timestamp at which the basket was last set
    function lastSet() external view returns (uint256 nonce_, uint256 timestamp_) {
        nonce_ = nonce;
        timestamp_ = timestamp;
    }
}

contract RTokenTestSystem is MainMock {
    using FixLib for int192;

    ERC20Mock public baseA;
    ERC20Mock public baseB;

    constructor(IRToken rToken_) {
        DeploymentParams memory params = defaultParams();
        ConstructorArgs memory args = defaultCtorArgs(params);

        baseA = new ERC20Mock("Base Token A", "A$");
        baseB = new ERC20Mock("Base Token B", "B$");
        for (uint256 i = 0; i < USERS.length; i++) {
            baseA.mint(USERS[i], 1e24);
            baseB.mint(USERS[i], 1e24);
        }

        init(args);
        basketHandler = new MockBasketHandler(baseA, baseB);
        basketHandler.initComponent(this, args);

        backingManager = new MockBackingManager();
        backingManager.initComponent(this, args);

        rToken = rToken_;
        rToken.initComponent(this, args);
    }

    function poke() public virtual override {
        basketHandler.ensureBasket(); // maaaaaaybe
        backingManager.settleTrades(); // maaaaaybe?
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
        return MainMock(address(main)).sender();
    }
}

contract RTokenP1Test is RToken {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory constitution_
    ) RToken(name_, symbol_, constitution_) {}

    function _msgSender() internal view virtual override returns (address) {
        return MainMock(address(main)).sender();
    }
}

contract RTokenDiffTest {
    using FixLib for int192;
    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    RTokenTestSystem public p0;
    RTokenTestSystem public p1;

    modifier fromSender() {
        p0.setSender(msg.sender);
        p1.setSender(msg.sender);
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    modifier fromBackingMgr() {
        p0.setSender(address(p0.backingManager()));
        p1.setSender(address(p1.backingManager()));
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    constructor() {
        p0 = new RTokenTestSystem(new RTokenP0Test("RToken", "RTK", "rtoken://1"));
        p1 = new RTokenTestSystem(new RTokenP1Test("RToken", "RTK", "rtoken://1"));
    }

    // Actions and state modifiers
    // TODO: assert that all return values are correct (or at least matcing?)
    // TODO: decorate with events for clues about test failures?

    // ==== user actions, performed by 0x[123]0000. Melt
    function issue(uint256 amount) external fromSender returns (uint256[] memory deposits) {
        amount %= 1e36;

        uint256[] memory deposits1;
        deposits = p0.rToken().issue(amount);
        deposits1 = p1.rToken().issue(amount);

        assert(deposits.length == deposits1.length);
        for (uint256 i = 0; i < deposits.length; i++) assert(deposits[i] == deposits1[i]);
    }

    function cancel(uint256 endId, bool e) external fromSender returns (uint256[] memory deposits) {
        deposits = p0.rToken().cancel(endId, e);
        uint256[] memory deposits1 = p1.rToken().cancel(endId, e);

        assert(deposits.length == deposits1.length);
        for (uint256 i = 0; i < deposits.length; i++) assert(deposits[i] == deposits1[i]);
    }

    function vest(address acct, uint256 endId) external fromSender returns (uint256 vested) {
        vested = p0.rToken().vest(acct, endId);
        uint256 vested1 = p1.rToken().vest(acct, endId);
        assert(vested == vested1);
    }

    // TODO: Add "cancel" and "vest" variations that are likely to succeed too
    // i.e, ones that have valid endIDs
    function redeem(uint256 amount) external fromSender returns (uint256[] memory compensation) {
        amount %= 1e36;

        compensation = p0.rToken().redeem(amount);
        uint256[] memory compensation1 = p1.rToken().redeem(amount);

        assert(compensation == compensation1);
    }

    function melt(uint256 amount) external fromSender {
        amount %= 1e36;
        p0.rToken().melt(amount);
        p1.rToken().melt(amount);
    }

    function mint(address recipient, uint256 amount) external fromBackingMgr {
        amount %= 1e36;
        recipient = address((uint160(recipient) % 3) * 0x10000); // mint only to USERS
        p0.rToken().mint(recipient, amount);
        p1.rToken().mint(recipient, amount);
    }

    function setBasketsNeeded(int192 basketsNeeded) external fromBackingMgr {
        basketsNeeded %= 1e36;
        p0.rToken().setBasketsNeeded(basketsNeeded);
        p1.rToken().setBasketsNeeded(basketsNeeded);
    }

    // Auth on these is that the caller needs to be main.owner. That... should be this contract?
    function setIssuanceRate(int192 val) external {
        val %= 1e24;
        assert(p0.owner() == address(this)); // hope but verify
        assert(p1.owner() == address(this));
        RTokenP0(address(p0.rToken())).setIssuanceRate(val);
        RToken(address(p1.rToken())).setIssuanceRate(val);
    }

    // TODO: changes to MockERC20 balances

    // Invariant: the observable rtoken prices are equal
    function echidna_prices_equal() external view returns (bool) {
        return p0.rToken().price() == p1.rToken().price();
    }

    function echidna_vesting_ids_equal() external view returns (bool) {
        return
            p0.rToken().endIdForVest(USERS[0]) == p1.rToken().endIdForVest(USERS[0]) &&
            p0.rToken().endIdForVest(USERS[1]) == p1.rToken().endIdForVest(USERS[1]) &&
            p0.rToken().endIdForVest(USERS[2]) == p1.rToken().endIdForVest(USERS[2]);
    }

    function echidna_baskets_needed_equal() external view returns (bool) {
        return p0.rToken().basketsNeeded() == p1.rToken().basketsNeeded();
    }

    function all_balances_equal(address acct0, address acct1) internal view returns (bool) {
        return
            p0.baseA().balanceOf(acct0) == p1.baseA().balanceOf(acct1) &&
            p0.baseB().balanceOf(acct0) == p1.baseB().balanceOf(acct1) &&
            p0.rToken().balanceOf(acct0) == p1.rToken().balanceOf(acct1);
    }

    function echidna_user_balances_equal() external view returns (bool equal) {
        equal =
            all_balances_equal(address(p0.backingManager()), address(p1.backingManager())) &&
            all_balances_equal(address(p0.basketHandler()), address(p1.basketHandler())) &&
            all_balances_equal(address(p0), address(p1));
        for (uint256 i = 0; i < USERS.length; i++) {
            equal = equal && all_balances_equal(USERS[i], USERS[i]);
        }
    }
}
