// @category BridgeBuilder
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.PrintWriter;
public class ExportEditorListing extends GhidraScript {
  public void run() throws Exception {
    try (PrintWriter out = new PrintWriter(getScriptArgs()[0])) {
      for (String address : new String[]{"00401aa4", "00408ac0", "0040901c", "00408ea4", "00409280", "00404dbc", "0040c99f", "0040e2e4"}) {
        Function function = getFunctionAt(toAddr(address));
        if (function == null) continue;
        out.println("\n" + address + " " + function.getName());
        InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
          Instruction instruction = instructions.next();
          out.println(instruction.getAddress() + " " + instruction);
        }
      }
    }
  }
}
