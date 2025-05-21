// Helper for formatting arguments, especially for structured data that might be nested
function _formatStructuredArg(arg: any, seen: Set<any>): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  // Strings within structures are typically quoted by console.log
  if (typeof arg === 'string') return `'${arg}'`;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (typeof arg === 'function') return `[Function: ${arg.name || '(anonymous)'}]`;
  if (typeof arg === 'symbol') return String(arg); // e.g., "Symbol(description)"

  // Handle specific object types before generic object processing
  if (arg instanceof Date) return arg.toISOString(); // e.g., "2023-01-01T12:00:00.000Z"
  if (arg instanceof RegExp) return String(arg); // e.g., "/pattern/gi"
  if (arg instanceof Error) return String(arg); // e.g., "Error: message"

  if (typeof arg === 'object') { // This check should be after specific known object types
    if (seen.has(arg)) return '\'[Circular]\''; // Represent circular references
    seen.add(arg);

    if (Array.isArray(arg)) {
      const arrElements = arg.map(el => _formatStructuredArg(el, new Set(seen)));
      return `[ ${arrElements.join(', ')} ]`;
    }
    else {
      // Generic object formatting
      const objectArg = arg as Record<string, any>; // Linter fix: Assert arg is an indexable object
      const keys = Object.keys(objectArg); // Gets own enumerable string-keyed properties
      const props = keys.map((key) => {
        const value = objectArg[key]; // Use the asserted type
        const valStr = _formatStructuredArg(value, new Set(seen));
        return `${key}: ${valStr}`;
      });

      const constructorName = arg.constructor?.name;
      let prefix = '';
      // Add a prefix for objects that are not plain Objects or Arrays
      if (constructorName && constructorName !== 'Object' && !Array.isArray(arg)) {
        prefix = constructorName + ' ';
      }

      if (props.length === 0) { // Handles MyClass {} or just {}
        return `${prefix}{}`;
      }
      return `${prefix}{ ${props.join(', ')} }`;
    }
  }
  return String(arg); // Fallback for any other unhandled types
}

// Top-level formatter for an individual argument passed directly to log()
function formatArgForLog(arg: any): string {
  if (typeof arg === 'string') return arg; // Top-level strings are not quoted by console.log
  if (typeof arg === 'symbol') return String(arg); // Symbols are also formatted directly

  if (typeof arg === 'object' && arg !== null) {
    // For top-level objects/arrays, use the structured formatter
    // A new Set for 'seen' is created for each top-level structured argument
    return _formatStructuredArg(arg, new Set());
  }
  // For other primitives (number, boolean, null, undefined) at top level
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  return String(arg);
}

export default {
  log: (message?: any, ...optionalParams: any[]): void => {
    // Combine message and optionalParams into a single args array for easier processing
    const args = (message === undefined && optionalParams.length === 0) ? [] : [message, ...optionalParams];

    if (args.length === 0) {
      print(''); // Lua's print() with no args prints a newline; print("") does too.
      return;
    }

    // Check if the first argument is a string to handle C-style format specifiers
    if (typeof args[0] === 'string') {
      const fmtStr = args[0];
      const substitutionArgs = args.slice(1);
      let currentArgIndex = 0;

      // Regex for %s (string), %d/%i (integer), %f (float),
      // %o/%O (object view), %j (JSON-like, here same as %o)
      // Note: %c (CSS styling) is not supported in this basic implementation.
      const formatSpecifierRegex = new RegExp('%[sdifoOj]', 'g'); // Linter fix: Use RegExp constructor
      const formattedString = fmtStr.replaceAll(formatSpecifierRegex, (match) => {
        if (currentArgIndex < substitutionArgs.length) {
          const currentArg = substitutionArgs[currentArgIndex];
          currentArgIndex++; // Consume the argument
          switch (match) {
            case '%s': {
              return String(currentArg);
            }
            case '%d':
            case '%i': {
              const num = Number.parseInt(String(currentArg), 10);
              return Number.isNaN(num) ? 'NaN' : String(num);
            }
            case '%f': {
              const floatNum = Number.parseFloat(String(currentArg));
              return Number.isNaN(floatNum) ? 'NaN' : String(floatNum);
            }
            case '%o': // Detailed object view
            case '%O': // "Optimal" object formatting, often JS-like
            case '%j': { // JSON-like representation (our _formatStructuredArg isn't strict JSON)
              // For these, use the structured formatter with a new 'seen' set
              return _formatStructuredArg(currentArg, new Set());
            }
            default: {
              return match;
            } // Should not be reached with the current regex
          }
        }
        return match; // Not enough arguments for substitution, leave specifier as is
      });

      // Append any remaining arguments that weren't consumed by format specifiers.
      // These remaining args should be formatted as if they were top-level individual args.
      const remainingFormattedArgs = substitutionArgs.slice(currentArgIndex)
        .map(arg => formatArgForLog(arg));

      // Join the main formatted string with any remaining arguments
      const finalMessage = [formattedString, ...remainingFormattedArgs].join(' ');
      print(finalMessage);
    }
    else {
      // First argument is not a string, or no format specifiers were intended.
      // Format all arguments individually using formatArgForLog and join with spaces.
      const output = args.map(arg => formatArgForLog(arg)).join(' ');
      print(output);
    }
  },
};
