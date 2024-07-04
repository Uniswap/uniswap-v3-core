pragma solidity =0.7.6;
pragma abicoder v2;

import '../../../../../contracts/test/TestERC20.sol';
import '../../../../../contracts/UniswapV3Pool.sol';
import '../../../../../contracts/UniswapV3Factory.sol';

contract SetupToken {
    TestERC20 public token;

    constructor() public {
        // this contract will receive the total supply of 100 tokens
        token = new TestERC20(1e12 ether);
    }

    function mintTo(address _recipient, uint256 _amount) public {
        token.transfer(_recipient, _amount);
    }
}

contract SetupTokens {
    SetupToken tokenSetup0;
    SetupToken tokenSetup1;

    TestERC20 public token0;
    TestERC20 public token1;

    constructor() public {
        // create the token wrappers
        tokenSetup0 = new SetupToken();
        tokenSetup1 = new SetupToken();

        // switch them around so that token0's address is lower than token1's
        // since this is what the uniswap factory will do when you create the pool
        if (address(tokenSetup0.token()) > address(tokenSetup1.token())) {
            (tokenSetup0, tokenSetup1) = (tokenSetup1, tokenSetup0);
        }

        // save the erc20 tokens
        token0 = tokenSetup0.token();
        token1 = tokenSetup1.token();
    }

    // mint either token0 or token1 to a chosen account
    function mintTo(
        uint256 _tokenIdx,
        address _recipient,
        uint256 _amount
    ) public {
        require(_tokenIdx == 0 || _tokenIdx == 1, 'invalid token idx');
        if (_tokenIdx == 0) tokenSetup0.mintTo(_recipient, _amount);
        if (_tokenIdx == 1) tokenSetup1.mintTo(_recipient, _amount);
    }
}

contract SetupUniswap {
    UniswapV3Pool public pool;
    TestERC20 token0;
    TestERC20 token1;

    // will create the following enabled fees and corresponding tickSpacing
    // fee 500   + tickSpacing 10
    // fee 3000  + tickSpacing 60
    // fee 10000 + tickSpacing 200
    UniswapV3Factory factory;

    constructor(TestERC20 _token0, TestERC20 _token1) public {
        factory = new UniswapV3Factory(100 ether);
        token0 = _token0;
        token1 = _token1;
    }

    function createPool(uint24 _fee, uint160 _startPrice) public {
        pool = UniswapV3Pool(factory.createPool(address(token0), address(token1), _fee));
        pool.initialize(_startPrice);
    }
}

contract UniswapMinter {
    UniswapV3Pool pool;
    TestERC20 token0;
    TestERC20 token1;

    struct MinterStats {
        uint128 liq;
        uint128 tL_liqGross;
        int128 tL_liqNet;
        uint128 tU_liqGross;
        int128 tU_liqNet;
    }

    constructor(TestERC20 _token0, TestERC20 _token1) public {
        token0 = _token0;
        token1 = _token1;
    }

    function setPool(UniswapV3Pool _pool) public {
        pool = _pool;
    }

    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external {
        if (amount0Owed > 0) token0.transfer(address(pool), amount0Owed);
        if (amount1Owed > 0) token1.transfer(address(pool), amount1Owed);
    }

    function getTickLiquidityVars(int24 _tickLower, int24 _tickUpper)
        internal
        view
        returns (
            uint128,
            int128,
            uint128,
            int128
        )
    {
        (uint128 tL_liqGross, int128 tL_liqNet, , ) = pool.ticks(_tickLower);
        (uint128 tU_liqGross, int128 tU_liqNet, , ) = pool.ticks(_tickUpper);
        return (tL_liqGross, tL_liqNet, tU_liqGross, tU_liqNet);
    }

    function getStats(int24 _tickLower, int24 _tickUpper) internal view returns (MinterStats memory stats) {
        (uint128 tL_lg, int128 tL_ln, uint128 tU_lg, int128 tU_ln) = getTickLiquidityVars(_tickLower, _tickUpper);
        return MinterStats(pool.liquidity(), tL_lg, tL_ln, tU_lg, tU_ln);
    }

    function doMint(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _amount
    ) public returns (MinterStats memory bfre, MinterStats memory aftr) {
        bfre = getStats(_tickLower, _tickUpper);
        pool.mint(address(this), _tickLower, _tickUpper, _amount, new bytes(0));
        aftr = getStats(_tickLower, _tickUpper);
    }

    function doBurn(
        int24 _tickLower,
        int24 _tickUpper,
        uint128 _amount
    ) public returns (MinterStats memory bfre, MinterStats memory aftr) {
        bfre = getStats(_tickLower, _tickUpper);
        pool.burn(_tickLower, _tickUpper, _amount);
        aftr = getStats(_tickLower, _tickUpper);
    }
}

contract UniswapSwapper {
    UniswapV3Pool pool;
    TestERC20 token0;
    TestERC20 token1;

    struct SwapperStats {
        uint128 liq;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        uint256 bal0;
        uint256 bal1;
        int24 tick;
    }

    constructor(TestERC20 _token0, TestERC20 _token1) public {
        token0 = _token0;
        token1 = _token1;
    }

    function setPool(UniswapV3Pool _pool) public {
        pool = _pool;
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        if (amount0Delta > 0) token0.transfer(address(pool), uint256(amount0Delta));
        if (amount1Delta > 0) token1.transfer(address(pool), uint256(amount1Delta));
    }

    function getStats() internal view returns (SwapperStats memory stats) {
        (, int24 currentTick, , , , , ) = pool.slot0();
        return
            SwapperStats(
                pool.liquidity(),
                pool.feeGrowthGlobal0X128(),
                pool.feeGrowthGlobal1X128(),
                token0.balanceOf(address(this)),
                token1.balanceOf(address(this)),
                currentTick
            );
    }

    function doSwap(
        bool _zeroForOne,
        int256 _amountSpecified,
        uint160 _sqrtPriceLimitX96
    ) public returns (SwapperStats memory bfre, SwapperStats memory aftr) {
        bfre = getStats();
        pool.swap(address(this), _zeroForOne, _amountSpecified, _sqrtPriceLimitX96, new bytes(0));
        aftr = getStats();
    }
}
