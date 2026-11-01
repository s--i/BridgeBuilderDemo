// @category BridgeBuilder
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.PrintWriter;
public class ExportPhysicsListing extends GhidraScript {
  public void run() throws Exception {
    try (PrintWriter out = new PrintWriter(getScriptArgs()[0])) {
      for (String address : new String[]{"00408018", "0040823c", "00408398", "0040c96a", "0040c0f8"}) {
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
