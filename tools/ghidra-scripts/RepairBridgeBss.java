// Restore the old Watcom PE's uninitialized section size in the database only.
// @category BridgeBuilder
import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

public class RepairBridgeBss extends GhidraScript {
    public void run() throws Exception {
        if (!"ab6db43e012151b3fea3e82021b2841d701170b2c790b74a7018fd16dbf4fe38".equals(currentProgram.getExecutableSHA256())) {
            throw new IllegalArgumentException("This repair applies only to the extracted Bridge Builder executable.");
        }
        // Original .bss header: VirtualSize=0, SizeOfRawData=0x5b4800,
        // PointerToRawData=0, uninitialized-data flag set. Ghidra clamps the
        // size to the input file length even though this section has no bytes.
        Memory memory = currentProgram.getMemory();
        MemoryBlock bss = memory.getBlock(".bss");
        long size = 0x5b4800L;
        if (bss == null || bss.isInitialized() || bss.getStart().getOffset() != 0x41c000L || bss.getSize() > size) {
            throw new IllegalStateException("Unexpected .bss layout");
        }
        if (bss.getSize() < size) {
            MemoryBlock tail = memory.createUninitializedBlock(".bss_extension", bss.getEnd().add(1), size - bss.getSize(), false);
            tail.setRead(bss.isRead());
            tail.setWrite(bss.isWrite());
            tail.setExecute(bss.isExecute());
            bss = memory.join(bss, tail);
            println("Restored .bss: " + bss.getStart() + "-" + bss.getEnd());
        }
        analyzeAll(currentProgram);
    }
}
