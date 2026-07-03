import { BruteForceSerializer, ITypeHelper } from "./BruteForceSerializer";

// BruteForceSerializer powers the game save/restore feature: it turns a live
// model graph (custom classes, Maps, Sets, shared/circular references) into
// JSON and rebuilds real class instances from it. This round-trip is what lets
// a page refresh resume a game exactly where it left off.

class TestChild {
  id = "";
}

class TestModel {
  name = "";
  count = 0;
  tags: string[] = [];
  child?: TestChild;
  friends = new Map<string, TestChild>();
  labels = new Set<string>();
  self?: TestModel; // used to exercise circular references
  secret = "hidden"; // excluded from serialization by the type helper
}

// A type helper the serializer needs to name/construct our classes. It must also
// recognise the built-in containers, exactly as the real game type helpers do.
function makeTypeHelper(reconstitute: ITypeHelper["reconstitute"] = (_t, _p, o) => o): ITypeHelper {
  return {
    rootTypeName: "TestModel",
    getTypeName(o: object) {
      if (o instanceof TestModel) return "TestModel";
      if (o instanceof TestChild) return "TestChild";
      if (o instanceof Map) return "Map";
      if (o instanceof Set) return "Set";
      if (o.constructor === Object) return "Object";
      return undefined;
    },
    constructType(typeName: string): object {
      switch (typeName) {
        case "TestModel":
          return new TestModel();
        case "TestChild":
          return new TestChild();
      }
      return {};
    },
    shouldStringify(_typeName, propertyName) {
      return propertyName !== "secret";
    },
    reconstitute,
  };
}

function makeModel() {
  const model = new TestModel();
  model.name = "root";
  model.count = 5;
  model.tags = ["a", "b"];
  const child = new TestChild();
  child.id = "c1";
  model.child = child;
  model.friends.set("x", child); // same instance as model.child (shared ref)
  model.labels.add("red");
  model.labels.add("blue");
  model.secret = "should not survive";
  return model;
}

describe("BruteForceSerializer", () => {
  it("round-trips scalar and array properties into a real class instance", () => {
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    expect(back).toBeInstanceOf(TestModel);
    expect(back.name).toBe("root");
    expect(back.count).toBe(5);
    expect(back.tags).toEqual(["a", "b"]);
  });

  it("rebuilds nested class instances", () => {
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    expect(back.child).toBeInstanceOf(TestChild);
    expect(back.child!.id).toBe("c1");
  });

  it("restores Maps and Sets", () => {
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    expect(back.friends).toBeInstanceOf(Map);
    expect(back.friends.get("x")).toBeInstanceOf(TestChild);
    expect(back.friends.get("x")!.id).toBe("c1");

    expect(back.labels).toBeInstanceOf(Set);
    expect(back.labels.has("red")).toBe(true);
    expect(back.labels.has("blue")).toBe(true);
  });

  it("preserves shared references as the same instance", () => {
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    // model.child and model.friends.get("x") were the same object.
    expect(back.friends.get("x")).toBe(back.child);
  });

  it("handles circular references", () => {
    const model = makeModel();
    model.self = model;
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(model));

    expect(back.self).toBe(back);
  });

  it("omits properties the type helper says not to stringify", () => {
    const serializer = new BruteForceSerializer(makeTypeHelper());
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    // The saved value ("should not survive") must not be persisted; the
    // rebuilt instance falls back to the constructor's default instead.
    expect(back.secret).not.toBe("should not survive");
    expect(back.secret).toBe("hidden");
  });

  it("applies the type helper's reconstitute hook on parse", () => {
    const upperCaseTags: ITypeHelper["reconstitute"] = (_t, propertyName, value) =>
      propertyName === "tags" ? (value as string[]).map((s) => s.toUpperCase()) : value;
    const serializer = new BruteForceSerializer(makeTypeHelper(upperCaseTags));
    const back = serializer.parse<TestModel>(serializer.stringify(makeModel()));

    expect(back.tags).toEqual(["A", "B"]);
  });
});
