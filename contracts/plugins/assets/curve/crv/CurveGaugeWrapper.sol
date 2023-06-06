// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../erc20/RewardableERC20.sol";

interface IMinter {
    /// Mint CRV to msg.sender based on their prorata share of the provided gauge
    function mint(address gaugeAddr) external;
}

interface ILiquidityGauge {
    /// @param _value LP token amount
    function deposit(uint256 _value) external;

    /// @param _value LP token amount
    function withdraw(uint256 _value) external;
}

contract CurveGaugeWrapper is RewardableERC20 {
    using SafeERC20 for IERC20;

    IMinter public constant MINTER = IMinter(0xd061D61a4d941c39E5453435B6345Dc261C2fcE0);

    IERC20 public immutable lpToken;

    ILiquidityGauge public immutable gauge;

    event Deposited(address indexed _user, address indexed _account, uint256 _amount);
    event Withdrawn(address indexed _user, address indexed _account, uint256 _amount);

    /// @param _lpToken The curve LP token, transferrable
    constructor(
        ERC20 _lpToken,
        string memory _name,
        string memory _symbol,
        ERC20 _crv,
        ILiquidityGauge _gauge
    ) ERC20(_name, _symbol) RewardableERC20(_crv) {
        lpToken = _lpToken;
        gauge = _gauge;
    }

    //deposit a curve token
    function deposit(uint256 _amount, address _to) external {
        //dont need to call checkpoint since _mint() will

        if (_amount > 0) {
            _mint(_to, _amount);
            lpToken.safeTransferFrom(msg.sender, address(this), _amount);
            lpToken.approve(address(gauge), _amount);
            gauge.deposit(_amount);
        }
        emit Deposited(msg.sender, _to, _amount);
    }

    //withdraw to curve token
    function withdraw(uint256 _amount, address _to) external {
        //dont need to call checkpoint since _burn() will

        if (_amount > 0) {
            _burn(msg.sender, _amount);
            gauge.withdraw(_amount);
            lpToken.safeTransfer(_to, _amount);
        }

        emit Withdrawn(msg.sender, _to, _amount);
    }

    function _claimAssetRewards() internal virtual override {
        MINTER.mint(address(gauge));
    }
}
