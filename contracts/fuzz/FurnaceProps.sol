// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Furnace.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/Mocks.sol";

contract RTokenMock is ERC20Mock {
    uint256 public totalMelted = 0;

    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20Mock("RToken Mock", "RTM") {}

    event Melt(address who, uint256 amount);

    function melt(uint256 amount) external {
        emit Melt(_msgSender(), amount);
        _burn(_msgSender(), amount);
        totalMelted += amount;
    }
}

contract FurnaceP0TestProps {
    using FixLib for uint192;

    MainMock public main;
    FurnaceP0 public furn1;
    FurnaceP0 public furn2;
    ERC20Mock public token;

    constructor() {
        // assume sensible period and ratio values
        // CHECK: can I use constructor parameters instead?
        DeploymentParams memory params = defaultParams();
        // reward params may be relevant here:
        params.rewardPeriod = 100;
        params.rewardRatio = toFix(1).divu(2);
        Components memory components;

        main = new MainMock();
        main.init(components, IERC20(address(0)), 0); // this be main.owner
        furn1 = new FurnaceP0();
        furn2 = new FurnaceP0();
        token = new RTokenMock();

        main.setRToken(IRToken(address(token)));
        furn1.init(IMain(address(main)), params.rewardPeriod, params.rewardRatio);
        furn2.init(IMain(address(main)), params.rewardPeriod, params.rewardRatio);

        setFunds(FIX_ONE);
        furn1.melt();
        furn2.melt();
    }

    function setPeriod(uint32 period) public {
        // restrict period values to [0, 10,000)
        furn1.melt();
        furn2.melt();
        period = (period % 9999) + 1;
        furn1.setPeriod(period);
        furn2.setPeriod(period);
    }

    function setRatio(uint192 ratio) public {
        // restrict fix values to (0, 1)
        furn1.melt();
        furn2.melt();
        ratio = (ratio % (FIX_ONE - 2)) + 1; // TODO: dirty Fix usage.
        furn1.setRatio(ratio);
        furn2.setRatio(ratio);
    }

    function setFunds(uint256 amount) public {
        furn1.melt();
        furn2.melt();
        token.burn(address(furn1), token.balanceOf(address(furn1)));
        token.burn(address(furn2), token.balanceOf(address(furn2)));
        // Amount should be a sane token amount: [0, 1e36]
        amount %= 1e36;
        token.mint(address(furn1), amount);
        token.mint(address(furn2), amount);
    }

    function meltOne() public {
        furn1.melt();
    }

    function meltTwo() public {
        furn2.melt();
    }

    event FurnaceAmounts(uint256 val1, uint256 val2);
    event LastPayout(string message, uint256 lastPayout);

    function echidna_EqualBalancesAfterMelt() public returns (bool) {
        emit FurnaceAmounts(token.balanceOf(address(furn1)), token.balanceOf(address(furn2)));
        emit LastPayout("furn1", furn1.lastPayout());
        emit LastPayout("furn2", furn2.lastPayout());
        furn1.melt();
        furn2.melt();
        emit FurnaceAmounts(token.balanceOf(address(furn1)), token.balanceOf(address(furn2)));
        emit LastPayout("furn1", furn1.lastPayout());
        emit LastPayout("furn2", furn2.lastPayout());

        uint256 bal1 = token.balanceOf(address(furn1));
        uint256 bal2 = token.balanceOf(address(furn2));

        return bal1 > bal2 ? bal1 - bal2 < 1e9 : bal2 - bal1 < 1e9;
    }
}
