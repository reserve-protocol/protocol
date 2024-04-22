// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;
// slither-disable-start reentrancy-no-eth

import "@openzeppelin/contracts-v0.7/math/SafeMath.sol";
import "@openzeppelin/contracts-v0.7/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v0.7/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-v0.7/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-v0.7/utils/ReentrancyGuard.sol";
import "./IRewardStaking.sol";

interface IBooster {
    function poolInfo(uint256 _pid)
        external
        view
        returns (
            address _lptoken,
            address _token,
            address _gauge,
            address _crvRewards,
            address _stash,
            bool _shutdown
        );

    function earmarkRewards(uint256 _pid) external returns (bool);
}

interface IConvexDeposits {
    function deposit(
        uint256 _pid,
        uint256 _amount,
        bool _stake
    ) external returns (bool);

    function deposit(
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}

interface ITokenWrapper {
    function token() external view returns (address);
}

// if used as collateral some modifications will be needed to fit the specific platform

// Based on audited contracts: https://github.com/convex-eth/platform/blob/933ace34d896e6684345c6795bf33d4089fbd8f6/contracts/contracts/wrappers/ConvexStakingWrapper.sol
contract ConvexStakingWrapper is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct EarnedData {
        address token;
        uint256 amount;
    }

    struct RewardType {
        address reward_token;
        address reward_pool;
        uint256 reward_integral;
        uint256 reward_remaining;
        mapping(address => uint256) reward_integral_for;
        mapping(address => uint256) claimable_reward;
    }

    //constants/immutables
    address public constant convexBooster = address(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    address public constant crv = address(0xD533a949740bb3306d119CC777fa900bA034cd52);
    address public constant cvx = address(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    address public curveToken;
    address public convexToken;
    address public convexPool;
    uint256 public convexPoolId;
    address public collateralVault;
    uint256 private constant CRV_INDEX = 0;
    uint256 private constant CVX_INDEX = 1;

    //rewards
    RewardType[] public rewards;
    mapping(address => uint256) public registeredRewards;
    mapping(address => address) public rewardRedirect;

    //management
    bool public isInit;

    string internal _tokenname;
    string internal _tokensymbol;

    event Deposited(
        address indexed _user,
        address indexed _account,
        uint256 _amount,
        bool _wrapped
    );
    event Withdrawn(address indexed _user, uint256 _amount, bool _unwrapped);
    event RewardRedirected(address indexed _account, address _forward);
    event RewardAdded(address _token);
    event UserCheckpoint(address _userA, address _userB);
    event RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount);

    constructor() public ERC20("StakedConvexToken", "stkCvx") {}

    function initialize(uint256 _poolId) external virtual {
        require(!isInit, "already init");

        (address _lptoken, address _token, , address _rewards, , ) = IBooster(convexBooster)
        .poolInfo(_poolId);
        curveToken = _lptoken;
        convexToken = _token;
        convexPool = _rewards;
        convexPoolId = _poolId;

        _tokenname = string(abi.encodePacked("Staked ", ERC20(_token).name()));
        _tokensymbol = string(abi.encodePacked("stk", ERC20(_token).symbol()));
        isInit = true;

        // collateralVault = _vault;

        //add rewards
        addRewards();
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

    function setApprovals() public {
        IERC20(curveToken).safeApprove(convexBooster, 0);
        IERC20(curveToken).safeApprove(convexBooster, uint256(-1));
        IERC20(convexToken).safeApprove(convexPool, 0);
        IERC20(convexToken).safeApprove(convexPool, uint256(-1));
    }

    function addRewards() public {
        address mainPool = convexPool;

        if (rewards.length == 0) {
            rewards.push(
                RewardType({
                    reward_token: crv,
                    reward_pool: mainPool,
                    reward_integral: 0,
                    reward_remaining: 0
                })
            );
            rewards.push(
                RewardType({
                    reward_token: cvx,
                    reward_pool: address(0),
                    reward_integral: 0,
                    reward_remaining: 0
                })
            );
            registeredRewards[crv] = CRV_INDEX + 1; //mark registered at index+1
            registeredRewards[cvx] = CVX_INDEX + 1; //mark registered at index+1
            //send to self to warmup state
            //slither-disable-next-line unchecked-transfer
            IERC20(crv).transfer(address(this), 0);
            //send to self to warmup state
            //slither-disable-next-line unchecked-transfer
            IERC20(cvx).transfer(address(this), 0);
            emit RewardAdded(crv);
            emit RewardAdded(cvx);
        }

        uint256 extraCount = IRewardStaking(mainPool).extraRewardsLength();
        for (uint256 i = 0; i < extraCount; ++i) {
            address extraPool = IRewardStaking(mainPool).extraRewards(i);
            address extraToken = IRewardStaking(extraPool).rewardToken();
            //from pool 151, extra reward tokens are wrapped
            if (convexPoolId >= 151) {
                extraToken = ITokenWrapper(extraToken).token();
            }
            if (extraToken == cvx) {
                //update cvx reward pool address
                rewards[CVX_INDEX].reward_pool = extraPool;
            } else if (registeredRewards[extraToken] == 0) {
                //add new token to list
                rewards.push(
                    RewardType({
                        reward_token: extraToken,
                        reward_pool: extraPool,
                        reward_integral: 0,
                        reward_remaining: 0
                    })
                );
                registeredRewards[extraToken] = rewards.length; //mark registered at index+1
                emit RewardAdded(extraToken);
            }
        }
    }

    function rewardLength() external view returns (uint256) {
        return rewards.length;
    }

    function _getDepositedBalance(address _account) internal view virtual returns (uint256) {
        if (_account == address(0) || _account == collateralVault) {
            return 0;
        }
        //get balance from collateralVault

        return balanceOf(_account);
    }

    function _getTotalSupply() internal view virtual returns (uint256) {
        //override and add any supply needed (interest based growth)

        return totalSupply();
    }

    //internal transfer function to transfer rewards out on claim
    function _transferReward(
        address _token,
        address _to,
        uint256 _amount
    ) internal virtual {
        IERC20(_token).safeTransfer(_to, _amount);
    }

    function _calcRewardIntegral(
        uint256 _index,
        address[2] memory _accounts,
        uint256[2] memory _balances,
        uint256 _supply,
        bool _isClaim
    ) internal {
        RewardType storage reward = rewards[_index];
        if (reward.reward_token == address(0)) {
            return;
        }

        //get difference in balance and remaining rewards
        //getReward is unguarded so we use reward_remaining to keep track of how much was actually claimed
        uint256 bal = IERC20(reward.reward_token).balanceOf(address(this));

        //check that balance increased and update integral
        if (_supply != 0 && bal > reward.reward_remaining) {
            reward.reward_integral =
                reward.reward_integral +
                (bal.sub(reward.reward_remaining).mul(1e20).div(_supply));
        }

        //update user integrals
        for (uint256 u = 0; u < _accounts.length; ++u) {
            //do not give rewards to address 0
            if (_accounts[u] == address(0)) continue;
            if (_accounts[u] == collateralVault) continue;
            if (_isClaim && u != 0) continue; //only update/claim for first address and use second as forwarding

            uint256 userI = reward.reward_integral_for[_accounts[u]];
            if (_isClaim || userI < reward.reward_integral) {
                if (_isClaim) {
                    uint256 receiveable = reward.claimable_reward[_accounts[u]].add(
                        _balances[u].mul(reward.reward_integral.sub(userI)).div(1e20)
                    );
                    if (receiveable != 0) {
                        reward.claimable_reward[_accounts[u]] = 0;
                        //cheat for gas savings by transfering to the second index in accounts list
                        //if claiming only the 0 index will update so 1 index can hold forwarding info
                        //guaranteed to have an address in u+1 so no need to check
                        _transferReward(reward.reward_token, _accounts[u + 1], receiveable);
                        bal = bal.sub(receiveable);
                    }
                } else {
                    reward.claimable_reward[_accounts[u]] = reward
                    .claimable_reward[_accounts[u]]
                    .add(_balances[u].mul(reward.reward_integral.sub(userI)).div(1e20));
                }
                reward.reward_integral_for[_accounts[u]] = reward.reward_integral;
            }
        }

        //update remaining reward here since balance could have changed if claiming
        if (bal != reward.reward_remaining) {
            reward.reward_remaining = bal;
        }
    }

    function _checkpoint(address[2] memory _accounts) internal nonReentrant {
        uint256 supply = _getTotalSupply();
        uint256[2] memory depositedBalance;
        depositedBalance[0] = _getDepositedBalance(_accounts[0]);
        depositedBalance[1] = _getDepositedBalance(_accounts[1]);

        IRewardStaking(convexPool).getReward(address(this), true);

        uint256 rewardCount = rewards.length;
        for (uint256 i = 0; i < rewardCount; ++i) {
            _calcRewardIntegral(i, _accounts, depositedBalance, supply, false);
        }
        emit UserCheckpoint(_accounts[0], _accounts[1]);
    }

    function _checkpointAndClaim(address[2] memory _accounts) internal nonReentrant {
        uint256 supply = _getTotalSupply();
        uint256[2] memory depositedBalance;
        depositedBalance[0] = _getDepositedBalance(_accounts[0]); //only do first slot

        IRewardStaking(convexPool).getReward(address(this), true);

        uint256 rewardCount = rewards.length;
        for (uint256 i = 0; i < rewardCount; ++i) {
            _calcRewardIntegral(i, _accounts, depositedBalance, supply, true);
        }
        emit UserCheckpoint(_accounts[0], _accounts[1]);
    }

    function user_checkpoint(address _account) external returns (bool) {
        _checkpoint([_account, address(0)]);
        return true;
    }

    function totalBalanceOf(address _account) external view returns (uint256) {
        return _getDepositedBalance(_account);
    }

    //run earned as a mutable function to claim everything before calculating earned rewards
    function earned(address _account) external returns (EarnedData[] memory claimable) {
        //checkpoint to pull in and tally new rewards
        _checkpoint([_account, address(0)]);
        return _earned(_account);
    }

    function _earned(address _account) internal view returns (EarnedData[] memory claimable) {
        uint256 rewardCount = rewards.length;
        claimable = new EarnedData[](rewardCount);

        for (uint256 i = 0; i < rewardCount; ++i) {
            RewardType storage reward = rewards[i];
            if (reward.reward_token == address(0)) {
                continue;
            }

            claimable[i].amount = reward.claimable_reward[_account];
            claimable[i].token = reward.reward_token;
        }
        return claimable;
    }

    function claimRewards() external {
        address _account = rewardRedirect[msg.sender] == address(0)
            ? msg.sender
            : rewardRedirect[msg.sender];

        uint256 cvxOldBal = IERC20(cvx).balanceOf(_account);
        uint256 crvOldBal = IERC20(crv).balanceOf(_account);
        _checkpointAndClaim([msg.sender, _account]);
        emit RewardsClaimed(IERC20(cvx), IERC20(cvx).balanceOf(_account) - cvxOldBal);
        emit RewardsClaimed(IERC20(crv), IERC20(crv).balanceOf(_account) - crvOldBal);
    }

    //set any claimed rewards to automatically go to a different address
    //set address to zero to disable
    function setRewardRedirect(address _to) external nonReentrant {
        rewardRedirect[msg.sender] = _to;
        emit RewardRedirected(msg.sender, _to);
    }

    function getReward(address _account) external {
        //check if there is a redirect address
        if (rewardRedirect[_account] != address(0)) {
            _checkpointAndClaim([_account, rewardRedirect[_account]]);
        } else {
            //claim directly in checkpoint logic to save a bit of gas
            _checkpointAndClaim([_account, _account]);
        }
    }

    function getReward(address _account, address _forwardTo) external {
        require(msg.sender == _account, "!self");
        //claim directly in checkpoint logic to save a bit of gas
        //pack forwardTo into account array to save gas so that a proxy etc doesnt have to double transfer
        _checkpointAndClaim([_account, _forwardTo]);
    }

    //deposit a curve token
    function deposit(uint256 _amount, address _to) external {
        //dont need to call checkpoint since _mint() will

        if (_amount != 0) {
            _mint(_to, _amount);
            IERC20(curveToken).safeTransferFrom(msg.sender, address(this), _amount);
            IConvexDeposits(convexBooster).deposit(convexPoolId, _amount, true);
        }

        emit Deposited(msg.sender, _to, _amount, true);
    }

    //stake a convex token
    function stake(uint256 _amount, address _to) external {
        //dont need to call checkpoint since _mint() will

        if (_amount != 0) {
            _mint(_to, _amount);
            IERC20(convexToken).safeTransferFrom(msg.sender, address(this), _amount);
            IRewardStaking(convexPool).stake(_amount);
        }

        emit Deposited(msg.sender, _to, _amount, false);
    }

    //withdraw to convex deposit token
    function withdraw(uint256 _amount) external {
        //dont need to call checkpoint since _burn() will

        if (_amount != 0) {
            _burn(msg.sender, _amount);
            IRewardStaking(convexPool).withdraw(_amount, false);
            IERC20(convexToken).safeTransfer(msg.sender, _amount);
        }

        emit Withdrawn(msg.sender, _amount, false);
    }

    //withdraw to underlying curve lp token
    function withdrawAndUnwrap(uint256 _amount) external {
        //dont need to call checkpoint since _burn() will

        if (_amount != 0) {
            _burn(msg.sender, _amount);
            IRewardStaking(convexPool).withdrawAndUnwrap(_amount, false);
            IERC20(curveToken).safeTransfer(msg.sender, _amount);
        }

        //events
        emit Withdrawn(msg.sender, _amount, true);
    }

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256
    ) internal override {
        _checkpoint([_from, _to]);
    }

    //helper function
    function earmarkRewards() external returns (bool) {
        return IBooster(convexBooster).earmarkRewards(convexPoolId);
    }
}
// slither-disable-end reentrancy-no-eth
