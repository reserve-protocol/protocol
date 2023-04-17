// SPDX-License-Identifier: MIT
pragma solidity >0.6.12 <0.9.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IBaseRewardPool.sol";
import "./interfaces/BPool.sol";
// import "./IRewardStaking.sol";


// TODO check on contract size to see if blocker
contract AuraStakingWrapper is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

      //constants/immutables
    address public constant balancerVault = address(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    address public constant bal = address(0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3);
    address public constant aura = address(0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF);
    address public rewardPool;
    address public lpToken;
    bytes32 public getPoolId;

    //management
    bool public isInit;
    address public owner;
    bool internal _isShutdown;

    string internal _tokenname;
    string internal _tokensymbol;

    event Deposited(
        address indexed _user,
        address indexed _account,
        uint256 _amount,
        bool _wrapped
    );
    event Withdrawn(address indexed _user, uint256 _amount, bool _unwrapped);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() public ERC20("AuraStakedBalancerPoolToken", "aurastkBPT") {}

    function initialize(bytes32 _poolId, address baseRewardPool) external virtual {
        require(!isInit, "already init");
        owner = msg.sender;
        emit OwnershipTransferred(address(0), owner);

        (address _lpToken,) = IVault(balancerVault).getPool(_poolId);
        require(_lpToken != address(0), "missing lp token address");
        rewardPool = baseRewardPool;
        lpToken = _lpToken;
        getPoolId = _poolId;

        _tokenname = string(abi.encodePacked("Aura Staked ", ERC20(_lpToken).name()));
        _tokensymbol = string(abi.encodePacked("aurastk", ERC20(_lpToken).symbol()));
        isInit = true;

        setApprovals();
    }

    function name() public view override returns (string memory) {
        return _tokenname;
    }

    function symbol() public view override returns (string memory) {
        return _tokensymbol;
    }

    function decimals() public view override returns (uint8) {
        return 18;
    }

    modifier onlyOwner() {
        require(owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() public virtual onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // function shutdown() external onlyOwner {
    //     _isShutdown = true;
    // }

    // function isShutdown() public view returns (bool) {
    //     if (_isShutdown) return true;
    //     (, , , , , bool isShutdown_) = IBooster(convexBooster).poolInfo(convexPoolId);
    //     return isShutdown_;
    // }

    function setApprovals() public {
        // IERC20(lpToken).safeApprove(balancerVault, 0);
        IERC20(lpToken).safeApprove(rewardPool , type(uint256).max);
    }

    function _getDepositedBalance(address _account) internal view virtual returns (uint256) {
        if (_account == address(0)) {
            return 0;
        }
        //get balance from collateralVault

        return balanceOf(_account);
    }

    function _getTotalSupply() internal view virtual returns (uint256) {
        //override and add any supply needed (interest based growth)

        return totalSupply();
    }

    function totalBalanceOf(address _account) external view returns (uint256) {
        return _getDepositedBalance(_account);
    }

    function getReward(address _account) external {
        IBaseRewardPool(rewardPool).getReward(_account, true);
    }

    //stake a balancer pool token in aura
    function stake(uint256 _amount, address _to) external {
        // require(!isShutdown(), "shutdown");

        if (_amount > 0) {
            _mint(_to, _amount);
            IERC20(lpToken).safeTransferFrom(msg.sender, address(this), _amount);
            IBaseRewardPool(rewardPool).deposit(_amount, address(this));
        }

        emit Deposited(msg.sender, _to, _amount, false);
    }

    //withdraw to convex deposit token
    function withdraw(uint256 _amount) external {
        //dont need to call checkpoint since _burn() will

        if (_amount > 0) {
            _burn(msg.sender, _amount);
            IBaseRewardPool(rewardPool).withdraw(_amount, address(this));
            IERC20(lpToken).safeTransfer(msg.sender, _amount);
        }

        emit Withdrawn(msg.sender, _amount, false);
    }

    function getVault() external view returns(address) {
        return address(BPool(lpToken).getVault());
    }

    // function _beforeTokenTransfer(
    //     address _from,
    //     address _to,
    //     uint256
    // ) internal override {
    //     _checkpoint([_from, _to]);
    // }
}