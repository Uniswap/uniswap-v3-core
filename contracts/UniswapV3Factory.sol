// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import './interfaces/IUniswapV3Factory.sol';

import './UniswapV3Pair.sol';
import './UniswapV3PairDeployer.sol';

contract UniswapV3Factory is IUniswapV3Factory, UniswapV3PairDeployer {
    address public override owner;

    mapping(uint24 => int24) public override feeAmountTickSpacing;
    uint24[] public override allEnabledFeeAmounts;

    mapping(address => mapping(address => mapping(uint24 => address))) public override getPair;
    address[] public override allPairs;

    mapping(address => bool) public pairBlacklist;
    mapping(address => mapping(bytes4 => bool)) public targetSigBlacklist;
    mapping(bytes4 => bool) public sigBlacklist;

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function allEnabledFeeAmountsLength() external view override returns (uint256) {
        return allEnabledFeeAmounts.length;
    }

    constructor(address _owner) {
        owner = _owner;
        emit OwnerChanged(address(0), _owner);

        enableFeeAmount(600, 12);
        enableFeeAmount(3000, 60);
        enableFeeAmount(9000, 180);

        // prevent the factory owner from approving any tokens or taking advantage of other account approvals
        appendSigToBlacklist(IERC20.approve.selector);
        appendSigToBlacklist(IERC20.transferFrom.selector);
    }

    function createPair(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external override returns (address pair) {
        require(tokenA != tokenB, 'A=B');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'A=0');
        int24 tickSpacing = feeAmountTickSpacing[fee];
        require(tickSpacing != 0, 'FNA');
        require(getPair[token0][token1][fee] == address(0), 'PAE');
        pair = deploy(address(this), token0, token1, fee, tickSpacing);
        allPairs.push(pair);
        getPair[token0][token1][fee] = pair;
        // populate mapping in the reverse direction, deliberate choice to avoid the cost of comparing addresses
        getPair[token1][token0][fee] = pair;
        emit PairCreated(token0, token1, fee, tickSpacing, pair, allPairs.length);
    }

    function setOwner(address _owner) external override {
        require(msg.sender == owner, 'OO');
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    function enableFeeAmount(uint24 fee, int24 tickSpacing) public override {
        require(msg.sender == owner, 'OO');
        require(fee < 1000000, 'FEE');
        require(tickSpacing > 0, 'TS');
        require(feeAmountTickSpacing[fee] == 0, 'FAI');

        feeAmountTickSpacing[fee] = tickSpacing;
        allEnabledFeeAmounts.push(fee);
        emit FeeAmountEnabled(fee, tickSpacing);
    }

    function appendSigToBlacklist(bytes4 sig) public override {
        require(msg.sender == owner, 'OO');
        sigBlacklist[sig] = true;
    }

    function appendTargetSigToBlacklist(address target, bytes4 sig) external override {
        require(msg.sender == owner, 'OO');
        targetSigBlacklist[target][sig] = true;
    }

    function appendPairToBlacklist(address pair) external override {
        require(msg.sender == owner, 'OO');
        pairBlacklist[pair] = true;
    }

    function isCallFromPairAllowed(address target, bytes4 sig) external view override returns (bool) {
        return !pairBlacklist[msg.sender] && !sigBlacklist[sig] && !targetSigBlacklist[target][sig];
    }
}
