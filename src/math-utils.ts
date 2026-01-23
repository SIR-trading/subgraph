import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";

// Constants for Q21.42 tick price format from Oracle
// The oracle returns tickPriceX42 where: tick = log_1.0001(price) * 2^42
export const LN_1_0001 = BigDecimal.fromString("0.000099995000333308"); // ln(1.0001)
export const SCALE_2_42 = BigDecimal.fromString("4398046511104"); // 2^42

// Pre-computed ln(2) for range reduction
const LN_2 = BigDecimal.fromString("0.693147180559945309417232121458");

// Tolerance for Newton-Raphson convergence
const SQRT_TOLERANCE = BigDecimal.fromString("0.000000000000001"); // 10^-15

/**
 * Natural logarithm using range reduction and Taylor series
 * ln(x) = ln(m * 2^k) = k*ln(2) + ln(m) where 1 <= m < 2
 * ln(m) is computed via Taylor series: ln(1+y) = y - y^2/2 + y^3/3 - y^4/4 + ...
 * where y = (m-1)/(m+1) for better convergence
 */
export function ln(x: BigDecimal): BigDecimal {
  // ln is undefined for x <= 0
  if (x.le(BigDecimal.fromString("0"))) {
    return BigDecimal.fromString("0");
  }

  const one = BigDecimal.fromString("1");
  const two = BigDecimal.fromString("2");

  // Range reduction: find k such that 1 <= x / 2^k < 2
  let k = 0;
  let m = x;

  // If x >= 2, divide by 2 repeatedly
  while (m.ge(two)) {
    m = m.div(two);
    k++;
  }

  // If x < 1, multiply by 2 repeatedly
  while (m.lt(one)) {
    m = m.times(two);
    k--;
  }

  // Now 1 <= m < 2, compute ln(m) using the identity:
  // ln(m) = 2 * artanh((m-1)/(m+1)) = 2 * sum_{n=0}^inf ((m-1)/(m+1))^(2n+1) / (2n+1)
  const y = (m.minus(one)).div(m.plus(one));
  const y2 = y.times(y);

  let sum = y;
  let term = y;
  let n = 1;

  // Taylor series: sum = y + y^3/3 + y^5/5 + y^7/7 + ...
  for (let i = 0; i < 50; i++) {
    term = term.times(y2);
    n += 2;
    const termContribution = term.div(BigDecimal.fromString(n.toString()));

    // Check for convergence
    if (termContribution.toString() == "0") {
      break;
    }
    sum = sum.plus(termContribution);
  }

  // ln(m) = 2 * sum
  const lnM = sum.times(two);

  // ln(x) = k * ln(2) + ln(m)
  const kDecimal = BigDecimal.fromString(k.toString());
  return kDecimal.times(LN_2).plus(lnM);
}

/**
 * Exponential function using Taylor series
 * exp(x) = sum_{n=0}^inf x^n / n!
 * For large |x|, we use: exp(x) = exp(x/2)^2 for range reduction
 */
export function exp(x: BigDecimal): BigDecimal {
  const zero = BigDecimal.fromString("0");
  const one = BigDecimal.fromString("1");
  const two = BigDecimal.fromString("2");

  // Handle negative exponents: exp(-x) = 1/exp(x)
  if (x.lt(zero)) {
    const expPositive = exp(x.neg());
    if (expPositive.equals(zero)) {
      return zero;
    }
    return one.div(expPositive);
  }

  // Range reduction: if x > 1, compute exp(x/2)^2 recursively
  if (x.gt(one)) {
    const half = exp(x.div(two));
    return half.times(half);
  }

  // Taylor series for |x| <= 1: exp(x) = 1 + x + x^2/2! + x^3/3! + ...
  let sum = one;
  let term = one;

  for (let n = 1; n <= 50; n++) {
    term = term.times(x).div(BigDecimal.fromString(n.toString()));

    // Check for convergence
    if (term.toString() == "0") {
      break;
    }
    sum = sum.plus(term);
  }

  return sum;
}

/**
 * Square root using Newton-Raphson iteration
 * x_{n+1} = (x_n + S/x_n) / 2
 */
export function sqrt(x: BigDecimal): BigDecimal {
  const zero = BigDecimal.fromString("0");
  const two = BigDecimal.fromString("2");

  // sqrt is undefined for x < 0
  if (x.le(zero)) {
    return zero;
  }

  // Initial guess: start with x/2 or 1, whichever is larger
  let guess = x.div(two);
  if (guess.lt(BigDecimal.fromString("1"))) {
    guess = BigDecimal.fromString("1");
  }

  // Newton-Raphson iteration
  for (let i = 0; i < 100; i++) {
    const nextGuess = guess.plus(x.div(guess)).div(two);

    // Check for convergence
    const diff = nextGuess.minus(guess);
    const absDiff = diff.lt(zero) ? diff.neg() : diff;

    if (absDiff.lt(SQRT_TOLERANCE)) {
      return nextGuess;
    }

    guess = nextGuess;
  }

  return guess;
}

/**
 * Absolute value for BigDecimal
 */
export function abs(x: BigDecimal): BigDecimal {
  const zero = BigDecimal.fromString("0");
  return x.lt(zero) ? x.neg() : x;
}
