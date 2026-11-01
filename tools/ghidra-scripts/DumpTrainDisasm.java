import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;

public class DumpTrainDisasm extends GhidraScript {
    @Override
    public void run() throws Exception {
        Address addr = toAddr(0x00409d78);
        Listing listing = currentProgram.getListing();
        Function func = listing.getFunctionAt(addr);
        if (func == null) {
            println("Function not found at " + addr);
            return;
        }
        println("Function: " + func.getName());
        Address maxAddr = func.getBody().getMaxAddress();
        Instruction inst = listing.getInstructionAt(addr);
        while (inst != null && inst.getAddress().compareTo(maxAddr) <= 0) {
            println(String.format("0x%s: %s", inst.getAddress(), inst.toString()));
            inst = inst.getNext();
        }
    }
}
