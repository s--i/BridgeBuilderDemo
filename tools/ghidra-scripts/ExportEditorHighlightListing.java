// @category BridgeBuilder
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.PrintWriter;

public class ExportEditorHighlightListing extends GhidraScript {
  public void run() throws Exception {
    try (PrintWriter out = new PrintWriter(getScriptArgs()[0])) {
      for (String address : new String[]{"0040aca0", "0040ae8c", "0040b470"}) {
        Function function = getFunctionAt(toAddr(address));
        if (function == null) continue;
        out.println("\n" + address + " " + function.getName());
        InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
          Instruction instruction = instructions.next();
          out.println(instruction.getAddress() + " " + instruction);
        }
      }
      out.println("\nDouble constants:");
      for (long address = 0x00418614L; address <= 0x00418664L; address += 8) {
        out.println(Long.toHexString(address) + " " + getDouble(toAddr(address)));
      }
    }
  }
}
